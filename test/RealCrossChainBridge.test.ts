




import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  RealCrossChainBridge,
  MockHeaderVerifier,
  MockERC20,
  SampleTargetReceiver,
} from "../typechain-types";

// ── Merkle tree helpers (OpenZeppelin commutativeKeccak256) ──────────────────

function commutativeKeccak256(a: string, b: string): string {
  const [lo, hi] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  return ethers.keccak256(ethers.concat([lo, hi]));
}

function buildDepth8Proof(leaves: string[], targetIndex: number): { proof: string[]; root: string } {
  const depth = 8;
  const size = 1 << depth; // 256
  const padded = new Array(size).fill(ethers.ZeroHash);
  for (let i = 0; i < leaves.length; i++) {
    padded[i] = leaves[i];
  }

  let currentLevel = padded;
  const proof: string[] = [];
  let index = targetIndex;

  for (let d = 0; d < depth; d++) {
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
    proof.push(currentLevel[siblingIndex]);

    const nextLevel: string[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      nextLevel.push(commutativeKeccak256(currentLevel[i], currentLevel[i + 1]));
    }
    currentLevel = nextLevel;
    index = Math.floor(index / 2);
  }

  return { proof, root: currentLevel[0] };
}

describe("RealCrossChainBridge", function () {
  const TTL = 3600; // 1 hour
  const GRACE = 600; // 10 minutes

  const N1_CHAIN_ID = 11155111n; // Sepolia
  const N2_CHAIN_ID = 80002n;    // Polygon Amoy

  let deployer: SignerWithAddress;
  let sender: SignerWithAddress;
  let recipient: SignerWithAddress;
  let liquidityProvider: SignerWithAddress;

  let bridgeN1: RealCrossChainBridge;
  let bridgeN2: RealCrossChainBridge;
  let headerVerifierN1: MockHeaderVerifier;
  let headerVerifierN2: MockHeaderVerifier;
  let tokenN1: MockERC20;
  let tokenN2: MockERC20;
  let sampleReceiver: SampleTargetReceiver;

  const ONE_ETH = ethers.parseEther("1");
  const TEN_ETH = ethers.parseEther("10");
  const THOUSAND_TOKENS = ethers.parseEther("1000");

  beforeEach(async () => {
    [deployer, sender, recipient, liquidityProvider] = await ethers.getSigners();

    // 1. Deploy Header Verifiers
    const HeaderVerifierFactory = await ethers.getContractFactory("MockHeaderVerifier");
    headerVerifierN1 = (await HeaderVerifierFactory.deploy()) as MockHeaderVerifier;
    headerVerifierN2 = (await HeaderVerifierFactory.deploy()) as MockHeaderVerifier;

    // 2. Deploy RealCrossChainBridge on both chains
    const BridgeFactory = await ethers.getContractFactory("RealCrossChainBridge");
    bridgeN1 = (await BridgeFactory.deploy(TTL, GRACE, await headerVerifierN1.getAddress())) as RealCrossChainBridge;
    bridgeN2 = (await BridgeFactory.deploy(TTL, GRACE, await headerVerifierN2.getAddress())) as RealCrossChainBridge;

    const bridgeN1Address = await bridgeN1.getAddress();
    const bridgeN2Address = await bridgeN2.getAddress();

    // 3. Configure Bidirectional Trust
    // N1 trusts N2 as remote bridge for N2_CHAIN_ID
    await bridgeN1.setTrustedRemote(N2_CHAIN_ID, bridgeN2Address);
    // N2 trusts N1 as remote bridge for N1_CHAIN_ID
    await bridgeN2.setTrustedRemote(N1_CHAIN_ID, bridgeN1Address);

    // 4. Deploy Mock ERC-20 Tokens (e.g. USDT)
    const ERC20Factory = await ethers.getContractFactory("MockERC20");
    tokenN1 = (await ERC20Factory.deploy("Tether USD", "USDT", 18)) as MockERC20;
    tokenN2 = (await ERC20Factory.deploy("Tether USD", "USDT", 18)) as MockERC20;

    const tokenN1Address = await tokenN1.getAddress();
    const tokenN2Address = await tokenN2.getAddress();

    // Map tokens: N1's token is mapped to N2's token on bridge N2, and vice versa
    await bridgeN2.setTokenMapping(N1_CHAIN_ID, tokenN1Address, tokenN2Address);
    await bridgeN1.setTokenMapping(N2_CHAIN_ID, tokenN2Address, tokenN1Address);

    // 5. Deploy Target Receiver contract on N2
    const ReceiverFactory = await ethers.getContractFactory("SampleTargetReceiver");
    sampleReceiver = (await ReceiverFactory.deploy()) as SampleTargetReceiver;

    // 6. Fund Bridge Vaults with Liquidity
    // Native liquidity: 10 ETH into Bridge N2 vault for payouts
    await bridgeN2.connect(liquidityProvider).depositLiquidity(ethers.ZeroAddress, 0, { value: TEN_ETH });
    // Native liquidity: 10 ETH into Bridge N1 vault
    await bridgeN1.connect(liquidityProvider).depositLiquidity(ethers.ZeroAddress, 0, { value: TEN_ETH });

    // ERC20 liquidity: 1,000 USDT into Bridge N2 vault
    await tokenN2.mint(liquidityProvider.address, THOUSAND_TOKENS);
    await tokenN2.connect(liquidityProvider).approve(bridgeN2Address, THOUSAND_TOKENS);
    await bridgeN2.connect(liquidityProvider).depositLiquidity(tokenN2Address, THOUSAND_TOKENS);
  });

  describe("Real Native Asset Payouts (ETH / POL)", () => {
    it("locks native ETH on N1 and executes real native payout on N2 to recipient", async () => {
      const bridgeN1Address = await bridgeN1.getAddress();
      const currentNetworkChainId = (await ethers.provider.getNetwork()).chainId;

      // Ensure bridge N2 trusts the local chainId as source for this test
      await bridgeN2.setTrustedRemote(currentNetworkChainId, bridgeN1Address);

      // 1. Sender initiates cross-chain transaction on N1
      const tx = await bridgeN1.connect(sender).initiate(
        currentNetworkChainId, // In test, dest is local network chainId
        recipient.address,
        ethers.ZeroAddress,    // Native asset
        ONE_ETH,
        ethers.ZeroAddress,    // No smart contract call, simple transfer
        "0x",
        { value: ONE_ETH }
      );
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      const filter = bridgeN1.filters.TransactionInitiated();
      const events = await bridgeN1.queryFilter(filter, receipt!.blockNumber, receipt!.blockNumber);
      const event = events[0].args;

      expect(event.id).to.equal(0n);
      expect(event.sender).to.equal(sender.address);
      expect(event.recipient).to.equal(recipient.address);
      expect(event.amount).to.equal(ONE_ETH);

      // 2. Off-chain Merkle proof generation
      const leaves = [event.leaf];
      const { proof, root } = buildDepth8Proof(leaves, 0);
      expect(await bridgeN1.root()).to.equal(root);

      // 3. Destination chain: Execute real transaction on N2
      const balanceBefore = await ethers.provider.getBalance(recipient.address);

      const header = { sourceBlock: BigInt(block!.number), root };
      const req = {
        id: 0n,
        sender: sender.address,
        recipient: recipient.address,
        token: ethers.ZeroAddress,
        amount: ONE_ETH,
        targetCall: ethers.ZeroAddress,
        callDataHash: ethers.keccak256("0x"),
        deadline: event.deadline,
        destChainId: currentNetworkChainId,
      };

      const execTx = await bridgeN2.connect(recipient).executeTransaction(
        currentNetworkChainId,
        header,
        proof,
        req,
        "0x"
      );
      const execReceipt = await execTx.wait();
      const gasUsed = execReceipt!.gasUsed * execReceipt!.gasPrice;

      // 4. Validate real native asset was delivered
      const balanceAfter = await ethers.provider.getBalance(recipient.address);
      expect(balanceAfter).to.equal(balanceBefore + ONE_ETH - gasUsed);

      // 5. Verify processed state
      expect(await bridgeN2.processed(currentNetworkChainId, 0n)).to.be.true;
    });

    it("supports reverse direction (N2 -> N1) with real native payout", async () => {
      const bridgeN2Address = await bridgeN2.getAddress();
      const currentNetworkChainId = (await ethers.provider.getNetwork()).chainId;

      await bridgeN1.setTrustedRemote(currentNetworkChainId, bridgeN2Address);

      // Sender locks on N2
      const tx = await bridgeN2.connect(sender).initiate(
        currentNetworkChainId,
        recipient.address,
        ethers.ZeroAddress,
        ONE_ETH,
        ethers.ZeroAddress,
        "0x",
        { value: ONE_ETH }
      );
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      const filter = bridgeN2.filters.TransactionInitiated();
      const events = await bridgeN2.queryFilter(filter, receipt!.blockNumber, receipt!.blockNumber);
      const event = events[0].args;

      const { proof, root } = buildDepth8Proof([event.leaf], 0);

      const balanceBefore = await ethers.provider.getBalance(recipient.address);

      const header = { sourceBlock: BigInt(block!.number), root };
      const req = {
        id: 0n,
        sender: sender.address,
        recipient: recipient.address,
        token: ethers.ZeroAddress,
        amount: ONE_ETH,
        targetCall: ethers.ZeroAddress,
        callDataHash: ethers.keccak256("0x"),
        deadline: event.deadline,
        destChainId: currentNetworkChainId,
      };

      const execTx = await bridgeN1.connect(recipient).executeTransaction(
        currentNetworkChainId,
        header,
        proof,
        req,
        "0x"
      );
      const execReceipt = await execTx.wait();
      const gasUsed = execReceipt!.gasUsed * execReceipt!.gasPrice;

      const balanceAfter = await ethers.provider.getBalance(recipient.address);
      expect(balanceAfter).to.equal(balanceBefore + ONE_ETH - gasUsed);
    });
  });

  describe("Real ERC-20 Token Transfers", () => {
    it("locks ERC20 on source and pays out mapped real ERC20 to recipient on destination", async () => {
      const bridgeN1Address = await bridgeN1.getAddress();
      const currentNetworkChainId = (await ethers.provider.getNetwork()).chainId;

      await bridgeN2.setTrustedRemote(currentNetworkChainId, bridgeN1Address);
      const tokenN1Address = await tokenN1.getAddress();
      const tokenN2Address = await tokenN2.getAddress();
      await bridgeN2.setTokenMapping(currentNetworkChainId, tokenN1Address, tokenN2Address);

      const transferAmount = ethers.parseEther("100");

      // Mint to sender and approve bridge N1
      await tokenN1.mint(sender.address, transferAmount);
      await tokenN1.connect(sender).approve(bridgeN1Address, transferAmount);

      // Lock on N1
      const tx = await bridgeN1.connect(sender).initiate(
        currentNetworkChainId,
        recipient.address,
        tokenN1Address,
        transferAmount,
        ethers.ZeroAddress,
        "0x"
      );
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      const filter = bridgeN1.filters.TransactionInitiated();
      const events = await bridgeN1.queryFilter(filter, receipt!.blockNumber, receipt!.blockNumber);
      const event = events[0].args;

      const { proof, root } = buildDepth8Proof([event.leaf], 0);

      // Execute on N2
      const recipientTokenBefore = await tokenN2.balanceOf(recipient.address);

      const header = { sourceBlock: BigInt(block!.number), root };
      const req = {
        id: 0n,
        sender: sender.address,
        recipient: recipient.address,
        token: tokenN1Address,
        amount: transferAmount,
        targetCall: ethers.ZeroAddress,
        callDataHash: ethers.keccak256("0x"),
        deadline: event.deadline,
        destChainId: currentNetworkChainId,
      };

      await bridgeN2.connect(recipient).executeTransaction(
        currentNetworkChainId,
        header,
        proof,
        req,
        "0x"
      );

      const recipientTokenAfter = await tokenN2.balanceOf(recipient.address);
      expect(recipientTokenAfter - recipientTokenBefore).to.equal(transferAmount);
    });
  });

  describe("Arbitrary Smart Contract Execution (target.call{value}(callData))", () => {
    it("executes arbitrary smart contract calls with native value cross-chain", async () => {
      const bridgeN1Address = await bridgeN1.getAddress();
      const receiverAddress = await sampleReceiver.getAddress();
      const currentNetworkChainId = (await ethers.provider.getNetwork()).chainId;

      await bridgeN2.setTrustedRemote(currentNetworkChainId, bridgeN1Address);

      const actionName = "CROSS_CHAIN_STAKE";
      const payload = ethers.toUtf8Bytes("USER_PAYLOAD_DATA");
      const callData = sampleReceiver.interface.encodeFunctionData("executeAction", [actionName, payload]);
      const callDataHash = ethers.keccak256(callData);

      // Sender initiates call with 0.5 ETH value attached
      const callValue = ethers.parseEther("0.5");
      const tx = await bridgeN1.connect(sender).initiate(
        currentNetworkChainId,
        recipient.address,
        ethers.ZeroAddress,
        callValue,
        receiverAddress,
        callData,
        { value: callValue }
      );
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      const filter = bridgeN1.filters.TransactionInitiated();
      const events = await bridgeN1.queryFilter(filter, receipt!.blockNumber, receipt!.blockNumber);
      const event = events[0].args;

      const { proof, root } = buildDepth8Proof([event.leaf], 0);

      const header = { sourceBlock: BigInt(block!.number), root };
      const req = {
        id: 0n,
        sender: sender.address,
        recipient: recipient.address,
        token: ethers.ZeroAddress,
        amount: callValue,
        targetCall: receiverAddress,
        callDataHash: callDataHash,
        deadline: event.deadline,
        destChainId: currentNetworkChainId,
      };

      const receiverBalanceBefore = await ethers.provider.getBalance(receiverAddress);

      // Execute on N2
      await expect(
        bridgeN2.connect(recipient).executeTransaction(currentNetworkChainId, header, proof, req, callData)
      )
        .to.emit(bridgeN2, "TargetCallExecuted")
        .withArgs(0n, receiverAddress, true, (data: string) => data !== undefined);

      // Verify sample receiver state was updated
      expect(await sampleReceiver.totalExecutions()).to.equal(1n);
      expect(await sampleReceiver.totalValueReceived()).to.equal(callValue);
      expect(await sampleReceiver.lastAction()).to.equal(actionName);

      const receiverBalanceAfter = await ethers.provider.getBalance(receiverAddress);
      expect(receiverBalanceAfter - receiverBalanceBefore).to.equal(callValue);
    });

    it("safely refunds native value to recipient if target call fails", async () => {
      const bridgeN1Address = await bridgeN1.getAddress();
      const receiverAddress = await sampleReceiver.getAddress();
      const currentNetworkChainId = (await ethers.provider.getNetwork()).chainId;

      await bridgeN2.setTrustedRemote(currentNetworkChainId, bridgeN1Address);

      // Invalid calldata that will cause targetCall to revert
      const invalidCallData = "0xdeadbeef123456";
      const callDataHash = ethers.keccak256(invalidCallData);
      const callValue = ethers.parseEther("0.5");

      const tx = await bridgeN1.connect(sender).initiate(
        currentNetworkChainId,
        recipient.address,
        ethers.ZeroAddress,
        callValue,
        receiverAddress,
        invalidCallData,
        { value: callValue }
      );
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      const filter = bridgeN1.filters.TransactionInitiated();
      const events = await bridgeN1.queryFilter(filter, receipt!.blockNumber, receipt!.blockNumber);
      const event = events[0].args;

      const { proof, root } = buildDepth8Proof([event.leaf], 0);

      const header = { sourceBlock: BigInt(block!.number), root };
      const req = {
        id: 0n,
        sender: sender.address,
        recipient: recipient.address,
        token: ethers.ZeroAddress,
        amount: callValue,
        targetCall: receiverAddress,
        callDataHash: callDataHash,
        deadline: event.deadline,
        destChainId: currentNetworkChainId,
      };

      const recipientBalBefore = await ethers.provider.getBalance(recipient.address);

      // Execution will catch target call failure and forward callValue directly to recipient
      const execTx = await bridgeN2.connect(recipient).executeTransaction(
        currentNetworkChainId,
        header,
        proof,
        req,
        invalidCallData
      );
      const execReceipt = await execTx.wait();
      const gasUsed = execReceipt!.gasUsed * execReceipt!.gasPrice;

      const recipientBalAfter = await ethers.provider.getBalance(recipient.address);
      expect(recipientBalAfter).to.equal(recipientBalBefore + callValue - gasUsed);
    });
  });

  describe("Security Guards & Edge Cases", () => {
    it("reverts on replay attack (submitting same request twice)", async () => {
      const bridgeN1Address = await bridgeN1.getAddress();
      const currentNetworkChainId = (await ethers.provider.getNetwork()).chainId;
      await bridgeN2.setTrustedRemote(currentNetworkChainId, bridgeN1Address);

      const tx = await bridgeN1.connect(sender).initiate(
        currentNetworkChainId,
        recipient.address,
        ethers.ZeroAddress,
        ONE_ETH,
        ethers.ZeroAddress,
        "0x",
        { value: ONE_ETH }
      );
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);
      const events = await bridgeN1.queryFilter(bridgeN1.filters.TransactionInitiated(), receipt!.blockNumber);
      const event = events[0].args;
      const { proof, root } = buildDepth8Proof([event.leaf], 0);

      const header = { sourceBlock: BigInt(block!.number), root };
      const req = {
        id: 0n,
        sender: sender.address,
        recipient: recipient.address,
        token: ethers.ZeroAddress,
        amount: ONE_ETH,
        targetCall: ethers.ZeroAddress,
        callDataHash: ethers.keccak256("0x"),
        deadline: event.deadline,
        destChainId: currentNetworkChainId,
      };

      // First execution succeeds
      await bridgeN2.connect(recipient).executeTransaction(currentNetworkChainId, header, proof, req, "0x");

      // Second execution reverts with AlreadyProcessed
      await expect(
        bridgeN2.connect(recipient).executeTransaction(currentNetworkChainId, header, proof, req, "0x")
      ).to.be.revertedWithCustomError(bridgeN2, "AlreadyProcessed");
    });

    it("reverts when request is expired", async () => {
      const bridgeN1Address = await bridgeN1.getAddress();
      const currentNetworkChainId = (await ethers.provider.getNetwork()).chainId;
      await bridgeN2.setTrustedRemote(currentNetworkChainId, bridgeN1Address);

      const tx = await bridgeN1.connect(sender).initiate(
        currentNetworkChainId,
        recipient.address,
        ethers.ZeroAddress,
        ONE_ETH,
        ethers.ZeroAddress,
        "0x",
        { value: ONE_ETH }
      );
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);
      const events = await bridgeN1.queryFilter(bridgeN1.filters.TransactionInitiated(), receipt!.blockNumber);
      const event = events[0].args;
      const { proof, root } = buildDepth8Proof([event.leaf], 0);

      // Fast-forward past deadline
      await time.increase(TTL + 10);

      const header = { sourceBlock: BigInt(block!.number), root };
      const req = {
        id: 0n,
        sender: sender.address,
        recipient: recipient.address,
        token: ethers.ZeroAddress,
        amount: ONE_ETH,
        targetCall: ethers.ZeroAddress,
        callDataHash: ethers.keccak256("0x"),
        deadline: event.deadline,
        destChainId: currentNetworkChainId,
      };

      await expect(
        bridgeN2.connect(recipient).executeTransaction(currentNetworkChainId, header, proof, req, "0x")
      ).to.be.revertedWithCustomError(bridgeN2, "Expired");
    });

    it("reverts when untrusted source chain submits", async () => {
      const currentNetworkChainId = (await ethers.provider.getNetwork()).chainId;
      const UNTRUSTED_CHAIN_ID = 999999n;

      const header = { sourceBlock: 100n, root: ethers.ZeroHash };
      const req = {
        id: 0n,
        sender: sender.address,
        recipient: recipient.address,
        token: ethers.ZeroAddress,
        amount: ONE_ETH,
        targetCall: ethers.ZeroAddress,
        callDataHash: ethers.keccak256("0x"),
        deadline: BigInt((await time.latest()) + 1000),
        destChainId: currentNetworkChainId,
      };

      await expect(
        bridgeN2.connect(recipient).executeTransaction(UNTRUSTED_CHAIN_ID, header, [], req, "0x")
      ).to.be.revertedWithCustomError(bridgeN2, "UntrustedSourceChain");
    });

    it("reverts on calldata hash mismatch", async () => {
      const bridgeN1Address = await bridgeN1.getAddress();
      const currentNetworkChainId = (await ethers.provider.getNetwork()).chainId;
      await bridgeN2.setTrustedRemote(currentNetworkChainId, bridgeN1Address);

      const targetCall = await sampleReceiver.getAddress();
      const legitimateCallData = "0x11223344";

      const tx = await bridgeN1.connect(sender).initiate(
        currentNetworkChainId,
        recipient.address,
        ethers.ZeroAddress,
        ONE_ETH,
        targetCall,
        legitimateCallData,
        { value: ONE_ETH }
      );
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);
      const events = await bridgeN1.queryFilter(bridgeN1.filters.TransactionInitiated(), receipt!.blockNumber);
      const event = events[0].args;
      const { proof, root } = buildDepth8Proof([event.leaf], 0);

      const header = { sourceBlock: BigInt(block!.number), root };
      const req = {
        id: 0n,
        sender: sender.address,
        recipient: recipient.address,
        token: ethers.ZeroAddress,
        amount: ONE_ETH,
        targetCall,
        callDataHash: event.callDataHash,
        deadline: event.deadline,
        destChainId: currentNetworkChainId,
      };

      // Attacker tries to substitute tampered calldata
      const tamperedCallData = "0x99887766";
      await expect(
        bridgeN2.connect(recipient).executeTransaction(currentNetworkChainId, header, proof, req, tamperedCallData)
      ).to.be.revertedWithCustomError(bridgeN2, "CalldataHashMismatch");
    });

    it("allows sender to reclaim locked funds after deadline + reclaimGrace", async () => {
      const currentNetworkChainId = (await ethers.provider.getNetwork()).chainId;

      const tx = await bridgeN1.connect(sender).initiate(
        currentNetworkChainId,
        recipient.address,
        ethers.ZeroAddress,
        ONE_ETH,
        ethers.ZeroAddress,
        "0x",
        { value: ONE_ETH }
      );
      await tx.wait();

      // Before expiry: reclaim reverts
      await expect(bridgeN1.connect(sender).reclaim(0n)).to.be.revertedWithCustomError(
        bridgeN1,
        "TooEarlyToReclaim"
      );

      // Fast forward past deadline + grace
      await time.increase(TTL + GRACE + 10);

      const senderBalBefore = await ethers.provider.getBalance(sender.address);
      const reclaimTx = await bridgeN1.connect(sender).reclaim(0n);
      const receipt = await reclaimTx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const senderBalAfter = await ethers.provider.getBalance(sender.address);
      expect(senderBalAfter).to.equal(senderBalBefore + ONE_ETH - gasUsed);

      // Double reclaim reverts
      await expect(bridgeN1.connect(sender).reclaim(0n)).to.be.revertedWith("Bridge: already reclaimed");
    });
  });

  describe("Liquidity Management", () => {
    it("allows depositing and withdrawing liquidity", async () => {
      const depositAmount = ethers.parseEther("2");
      await bridgeN1.connect(liquidityProvider).depositLiquidity(ethers.ZeroAddress, 0, { value: depositAmount });

      expect(await bridgeN1.getLiquidity(ethers.ZeroAddress)).to.be.gte(depositAmount);

      const recipientBalBefore = await ethers.provider.getBalance(recipient.address);
      await bridgeN1.connect(deployer).withdrawLiquidity(ethers.ZeroAddress, depositAmount, recipient.address);
      const recipientBalAfter = await ethers.provider.getBalance(recipient.address);

      expect(recipientBalAfter - recipientBalBefore).to.equal(depositAmount);
    });

    it("prevents non-owners from withdrawing liquidity", async () => {
      await expect(
        bridgeN1.connect(sender).withdrawLiquidity(ethers.ZeroAddress, ONE_ETH, sender.address)
      ).to.be.revertedWithCustomError(bridgeN1, "OwnableUnauthorizedAccount");
    });
  });
});
