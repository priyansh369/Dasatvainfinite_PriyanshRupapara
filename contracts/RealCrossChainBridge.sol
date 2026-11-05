// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/structs/MerkleTree.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IHeaderVerifier.sol";

/**
 * @title RealCrossChainBridge
 * @notice Production-grade, bidirectional cross-chain bridge and smart contract transaction executor.
 *         Enables real asset transfers (native ETH/POL and real ERC-20 tokens) via an on-chain liquidity vault,
 *         and arbitrary smart contract execution (target.call{value}(callData)) across chains.
 *
 * Symmetrically deployed on Ethereum Sepolia (N1) and Polygon Amoy (N2) for relayer-free, user-mediated operations.
 */
contract RealCrossChainBridge is ReentrancyGuard, Ownable {
    using MerkleTree for MerkleTree.Bytes32PushTree;
    using SafeERC20 for IERC20;

    // ── Custom Errors ────────────────────────────────────────────────────────

    error AlreadyProcessed(uint256 sourceChainId, uint256 id);
    error Expired(uint256 id, uint256 deadline, uint256 currentTime);
    error InvalidHeader();
    error InvalidProof(uint256 id);
    error UntrustedSourceChain(uint256 sourceChainId);
    error WrongDestinationChain(uint256 expectedChainId, uint256 receivedChainId);
    error CalldataHashMismatch(bytes32 expected, bytes32 actual);
    error InsufficientLiquidity(address token, uint256 requested, uint256 available);
    error ZeroAmount();
    error ZeroAddress();
    error TransferFailed();
    error TooEarlyToReclaim(uint256 id, uint256 unlockTime, uint256 currentTime);

    // ── Structs ──────────────────────────────────────────────────────────────

    /// @notice Parameters required to initiate a cross-chain transaction.
    struct InitiateParams {
        uint256 destChainId;
        address recipient;
        address token;        // address(0) for native ETH/POL, or ERC-20 token address
        uint256 amount;       // Amount of native coins or ERC-20 tokens
        address targetCall;   // address(0) for simple transfer, or target contract address
    }

    /// @notice Request payload passed when executing a cross-chain transaction on the destination chain.
    struct Request {
        uint256 id;
        address sender;
        address recipient;
        address token;        // address(0) for native ETH/POL, or ERC-20 token address
        uint256 amount;       // Amount of native coins or ERC-20 tokens
        address targetCall;   // address(0) for simple transfer, or target contract address
        bytes32 callDataHash; // keccak256(callData)
        uint256 deadline;
        uint256 destChainId;
    }

    /// @notice Metadata stored on the source chain for outgoing requests.
    struct RequestInfo {
        address sender;
        address recipient;
        address token;
        uint256 amount;
        address targetCall;
        bytes32 callDataHash;
        uint256 deadline;
        uint256 destChainId;
        bool reclaimed;
    }

    // ── Immutables & Config ──────────────────────────────────────────────────

    uint256 public immutable requestTtl;
    uint256 public immutable reclaimGrace;

    /// @notice Header verifier contract (light client / ZK proof verifier).
    IHeaderVerifier public headerVerifier;

    /// @notice Incremental Merkle tree storing outgoing request leaves (depth 8 = 256 leaves).
    MerkleTree.Bytes32PushTree private _tree;

    /// @notice Latest Merkle root for outgoing requests.
    bytes32 private _latestRoot;

    /// @notice Monotonically increasing outgoing request counter.
    uint256 public nextId;

    /// @notice Outgoing request id => RequestInfo.
    mapping(uint256 => RequestInfo) public outgoingRequests;

    /// @notice Tracks processed incoming requests: sourceChainId => requestId => bool.
    mapping(uint256 => mapping(uint256 => bool)) public processed;

    /// @notice Authorized remote bridge addresses: chainId => bridge address.
    mapping(uint256 => address) public trustedRemotes;

    /// @notice Maps source chain tokens to local chain tokens: sourceChainId => sourceToken => localToken.
    mapping(uint256 => mapping(address => address)) public tokenMapping;

    /// @notice Available liquidity deposited in the vault: token => balance.
    mapping(address => uint256) public liquidity;

    // ── Events ───────────────────────────────────────────────────────────────

    event TransactionInitiated(
        uint256 indexed id,
        address indexed sender,
        address indexed recipient,
        uint256 destChainId,
        address token,
        uint256 amount,
        address targetCall,
        bytes32 callDataHash,
        uint256 deadline,
        bytes32 leaf,
        bytes32 newRoot
    );

    event TransactionExecuted(
        uint256 indexed id,
        uint256 indexed sourceChainId,
        address indexed recipient,
        address token,
        uint256 amount,
        address targetCall
    );

    event TargetCallExecuted(
        uint256 indexed id,
        address indexed targetCall,
        bool success,
        bytes returnData
    );

    event Reclaimed(
        uint256 indexed id,
        address indexed sender,
        address token,
        uint256 amount
    );

    event LiquidityAdded(
        address indexed provider,
        address indexed token,
        uint256 amount
    );

    event LiquidityWithdrawn(
        address indexed to,
        address indexed token,
        uint256 amount
    );

    event TrustedRemoteSet(uint256 indexed chainId, address remoteBridge);
    event TokenMappingSet(uint256 indexed sourceChainId, address sourceToken, address localToken);
    event HeaderVerifierUpdated(address newVerifier);

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor(
        uint256 _requestTtl,
        uint256 _reclaimGrace,
        address _headerVerifier
    ) Ownable(msg.sender) {
        requestTtl = _requestTtl;
        reclaimGrace = _reclaimGrace;
        headerVerifier = IHeaderVerifier(_headerVerifier);

        // Setup depth 8 incremental Merkle tree with commutativeKeccak256
        _latestRoot = _tree.setup(8, bytes32(0));
    }

    // ── Admin Setters ────────────────────────────────────────────────────────

    function setTrustedRemote(uint256 chainId, address remoteBridge) external onlyOwner {
        if (remoteBridge == address(0)) revert ZeroAddress();
        trustedRemotes[chainId] = remoteBridge;
        emit TrustedRemoteSet(chainId, remoteBridge);
    }

    function setTokenMapping(
        uint256 sourceChainId,
        address sourceToken,
        address localToken
    ) external onlyOwner {
        tokenMapping[sourceChainId][sourceToken] = localToken;
        emit TokenMappingSet(sourceChainId, sourceToken, localToken);
    }

    function setHeaderVerifier(address _headerVerifier) external onlyOwner {
        if (_headerVerifier == address(0)) revert ZeroAddress();
        headerVerifier = IHeaderVerifier(_headerVerifier);
        emit HeaderVerifierUpdated(_headerVerifier);
    }

    // ── Leaf Calculation Pure Helper ─────────────────────────────────────────

    function computeLeaf(
        uint256 srcChainId,
        address srcBridge,
        uint256 dstChainId,
        uint256 id,
        address sender,
        address recipient,
        address token,
        uint256 amount,
        address targetCall,
        bytes32 callDataHash,
        uint256 deadline
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                srcChainId,
                srcBridge,
                dstChainId,
                id,
                sender,
                recipient,
                token,
                amount,
                targetCall,
                callDataHash,
                deadline
            )
        );
    }

    // ── Source Chain: Initiate Cross-Chain Transaction ───────────────────────

    /**
     * @notice Initiates a cross-chain transaction, locking native coins or ERC-20 tokens,
     *         and appending the request leaf to the on-chain Merkle tree.
     */
    function initiateTransaction(
        InitiateParams calldata params,
        bytes calldata callData
    ) external payable nonReentrant returns (uint256 id) {
        return _initiate(params, callData);
    }

    /**
     * @notice Convenience overload to initiate transaction with flattened arguments.
     */
    function initiate(
        uint256 destChainId,
        address recipient,
        address token,
        uint256 amount,
        address targetCall,
        bytes calldata callData
    ) external payable nonReentrant returns (uint256 id) {
        return _initiate(
            InitiateParams({
                destChainId: destChainId,
                recipient: recipient,
                token: token,
                amount: amount,
                targetCall: targetCall
            }),
            callData
        );
    }

    function _initiate(
        InitiateParams memory params,
        bytes calldata callData
    ) internal returns (uint256 id) {
        if (params.recipient == address(0)) revert ZeroAddress();

        if (params.token == address(0)) {
            // Native currency transfer / call value
            if (msg.value != params.amount) revert TransferFailed();
            if (params.amount == 0 && params.targetCall == address(0)) revert ZeroAmount();
        } else {
            // ERC-20 token transfer
            if (msg.value != 0) revert TransferFailed();
            if (params.amount == 0 && params.targetCall == address(0)) revert ZeroAmount();
            IERC20(params.token).safeTransferFrom(msg.sender, address(this), params.amount);
        }

        id = nextId++;
        uint256 deadline = block.timestamp + requestTtl;
        bytes32 callDataHash = keccak256(callData);

        bytes32 leaf = computeLeaf(
            block.chainid,
            address(this),
            params.destChainId,
            id,
            msg.sender,
            params.recipient,
            params.token,
            params.amount,
            params.targetCall,
            callDataHash,
            deadline
        );

        (uint256 index, bytes32 newRoot) = _tree.push(leaf);
        assert(index == id);
        _latestRoot = newRoot;

        outgoingRequests[id] = RequestInfo({
            sender: msg.sender,
            recipient: params.recipient,
            token: params.token,
            amount: params.amount,
            targetCall: params.targetCall,
            callDataHash: callDataHash,
            deadline: deadline,
            destChainId: params.destChainId,
            reclaimed: false
        });

        emit TransactionInitiated(
            id,
            msg.sender,
            params.recipient,
            params.destChainId,
            params.token,
            params.amount,
            params.targetCall,
            callDataHash,
            deadline,
            leaf,
            newRoot
        );
    }

    // ── Destination Chain: Verify & Execute Real Transaction ─────────────────

    /**
     * @notice Verifies the Merkle inclusion proof against the verified header and executes
     *         the real asset payout or smart contract call.
     * @param sourceChainId Chain ID of the source network.
     * @param header        Block header containing the source Merkle root.
     * @param proof         Merkle inclusion proof (depth 8 siblings).
     * @param req           The request data struct matching source parameters.
     * @param callData      The exact payload executed on targetCall (must match callDataHash).
     */
    function executeTransaction(
        uint256 sourceChainId,
        IHeaderVerifier.Header calldata header,
        bytes32[] calldata proof,
        Request calldata req,
        bytes calldata callData
    ) external nonReentrant {
        // 1. Destination chain check
        if (req.destChainId != block.chainid) {
            revert WrongDestinationChain(block.chainid, req.destChainId);
        }

        // 2. Untrusted source check
        address sourceBridge = trustedRemotes[sourceChainId];
        if (sourceBridge == address(0)) {
            revert UntrustedSourceChain(sourceChainId);
        }

        // 3. Replay guard
        if (processed[sourceChainId][req.id]) {
            revert AlreadyProcessed(sourceChainId, req.id);
        }

        // 4. Expiry guard
        if (block.timestamp > req.deadline) {
            revert Expired(req.id, req.deadline, block.timestamp);
        }

        // 5. Verify block header
        if (!headerVerifier.verifyHeader(header)) {
            revert InvalidHeader();
        }

        // 6. Verify calldata integrity if contract call specified
        if (req.targetCall != address(0)) {
            if (keccak256(callData) != req.callDataHash) {
                revert CalldataHashMismatch(req.callDataHash, keccak256(callData));
            }
        }

        // 7. Recompute leaf and verify Merkle proof
        bytes32 leaf = computeLeaf(
            sourceChainId,
            sourceBridge,
            block.chainid,
            req.id,
            req.sender,
            req.recipient,
            req.token,
            req.amount,
            req.targetCall,
            req.callDataHash,
            req.deadline
        );

        if (!MerkleProof.verify(proof, header.root, leaf)) {
            revert InvalidProof(req.id);
        }

        // 8. Mark processed before external interactions
        processed[sourceChainId][req.id] = true;

        // 9. Execute Real Value Settlement & Smart Contract Calls
        _dispatchExecution(sourceChainId, req, callData);

        emit TransactionExecuted(
            req.id,
            sourceChainId,
            req.recipient,
            req.token,
            req.amount,
            req.targetCall
        );
    }

    /// @dev Internal dispatcher for native/ERC20 payouts and arbitrary calls.
    function _dispatchExecution(
        uint256 sourceChainId,
        Request calldata req,
        bytes calldata callData
    ) internal {
        if (req.token == address(0)) {
            // ── Native Currency (ETH / POL) ──────────────────────────────────
            if (req.amount > 0) {
                if (address(this).balance < req.amount) {
                    revert InsufficientLiquidity(address(0), req.amount, address(this).balance);
                }
            }

            if (req.targetCall != address(0)) {
                // Execute arbitrary contract call with native value
                (bool success, bytes memory returnData) = req.targetCall.call{value: req.amount}(callData);
                if (!success) {
                    // Safe Fallback: if external call fails, forward funds directly to recipient so they are never lost
                    if (req.amount > 0) {
                        (bool refundOk, ) = req.recipient.call{value: req.amount}("");
                        if (!refundOk) revert TransferFailed();
                    }
                }
                emit TargetCallExecuted(req.id, req.targetCall, success, returnData);
            } else if (req.amount > 0) {
                // Simple native asset payout to recipient
                (bool ok, ) = req.recipient.call{value: req.amount}("");
                if (!ok) revert TransferFailed();
            }
        } else {
            // ── ERC-20 Token Settlement ──────────────────────────────────────
            address localToken = tokenMapping[sourceChainId][req.token];
            if (localToken == address(0)) {
                localToken = req.token; // Fallback to same address if 1:1 deployment
            }

            uint256 available = IERC20(localToken).balanceOf(address(this));
            if (req.amount > 0 && available < req.amount) {
                revert InsufficientLiquidity(localToken, req.amount, available);
            }

            if (req.targetCall != address(0)) {
                if (req.amount > 0) {
                    IERC20(localToken).forceApprove(req.targetCall, req.amount);
                }
                (bool success, bytes memory returnData) = req.targetCall.call(callData);
                if (!success) {
                    // Safe Fallback: reset approval and forward tokens directly to recipient
                    if (req.amount > 0) {
                        IERC20(localToken).forceApprove(req.targetCall, 0);
                        IERC20(localToken).safeTransfer(req.recipient, req.amount);
                    }
                }
                emit TargetCallExecuted(req.id, req.targetCall, success, returnData);
            } else if (req.amount > 0) {
                // Simple ERC-20 payout to recipient
                IERC20(localToken).safeTransfer(req.recipient, req.amount);
            }
        }
    }

    // ── Liquidity Management ─────────────────────────────────────────────────

    /**
     * @notice Deposit real native currency or ERC-20 tokens into the bridge liquidity vault.
     */
    function depositLiquidity(address token, uint256 amount) external payable {
        if (token == address(0)) {
            if (msg.value == 0) revert ZeroAmount();
            liquidity[address(0)] += msg.value;
            emit LiquidityAdded(msg.sender, address(0), msg.value);
        } else {
            if (amount == 0) revert ZeroAmount();
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
            liquidity[token] += amount;
            emit LiquidityAdded(msg.sender, token, amount);
        }
    }

    /**
     * @notice Withdraw liquidity from the vault (admin function).
     */
    function withdrawLiquidity(
        address token,
        uint256 amount,
        address to
    ) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (token == address(0)) {
            if (address(this).balance < amount) {
                revert InsufficientLiquidity(address(0), amount, address(this).balance);
            }
            if (liquidity[address(0)] >= amount) {
                liquidity[address(0)] -= amount;
            }
            (bool ok, ) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            if (IERC20(token).balanceOf(address(this)) < amount) {
                revert InsufficientLiquidity(token, amount, IERC20(token).balanceOf(address(this)));
            }
            if (liquidity[token] >= amount) {
                liquidity[token] -= amount;
            }
            IERC20(token).safeTransfer(to, amount);
        }
        emit LiquidityWithdrawn(to, token, amount);
    }

    // ── Reclaim / Refund ─────────────────────────────────────────────────────

    /**
     * @notice Refund locked assets to the sender if request expired without execution.
     * @param id The outgoing request id to refund.
     */
    function reclaim(uint256 id) external nonReentrant {
        RequestInfo storage req = outgoingRequests[id];
        if (req.sender == address(0)) revert ZeroAddress();
        require(req.sender == msg.sender, "Bridge: not sender");
        require(!req.reclaimed, "Bridge: already reclaimed");

        uint256 unlockTime = req.deadline + reclaimGrace;
        if (block.timestamp <= unlockTime) {
            revert TooEarlyToReclaim(id, unlockTime, block.timestamp);
        }

        req.reclaimed = true;
        uint256 amount = req.amount;
        address token = req.token;

        if (token == address(0)) {
            if (amount > 0) {
                (bool ok, ) = msg.sender.call{value: amount}("");
                if (!ok) revert TransferFailed();
            }
        } else {
            if (amount > 0) {
                IERC20(token).safeTransfer(msg.sender, amount);
            }
        }

        emit Reclaimed(id, msg.sender, token, amount);
    }

    // ── View Helpers ─────────────────────────────────────────────────────────

    /// @notice Returns the current Merkle root of all outgoing requests.
    function root() external view returns (bytes32) {
        return _latestRoot;
    }

    /// @notice Get liquidity available for a given token.
    function getLiquidity(address token) external view returns (uint256) {
        if (token == address(0)) {
            return address(this).balance;
        } else {
            return IERC20(token).balanceOf(address(this));
        }
    }

    // ── Direct Native Payout Funding ─────────────────────────────────────────

    receive() external payable {
        liquidity[address(0)] += msg.value;
        emit LiquidityAdded(msg.sender, address(0), msg.value);
    }
}
