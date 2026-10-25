import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
  Router,
  Verifier,
  WrappedDemo,
  MockHeaderVerifier,
} from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// ── Off-chain Merkle helpers (mirroring OZ commutativeKeccak256) ─────────────
//
// OZ's MerkleTree uses commutativeKeccak256: hash(a, b) = keccak256(sort(a, b)).
// We replicate that here to build proofs in tests without an off-chain library.
//
// KNOWN LIMITATION: The proof-building below only works for a single-leaf tree
// (depth 8, zero-padded).  For multiple leaves a full tree must be reconstructed;
// a production client should use merkletreejs configured with the same hasher.

function commutativeKeccak256(a: string, b: string): string {
  // Sort lexicographically (same as OZ Hashes.commutativeKeccak256)
  const [lo, hi] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  return ethers.keccak256(ethers.concat([lo, hi]));
}

/**
 * Build a depth-8 Merkle proof for a single leaf at index 0.
 *
 * OZ initialises the tree with `zero = bytes32(0)`.
 * The zero value for depth d is: z[0]=0x0, z[d] = commutativeKeccak256(z[d-1], z[d-1]).
 *
 * For the first (and only) leaf at index 0 the sibling at every level is the
 * zero-hash for that depth.
 */
function buildProofForLeafZero(leaf: string, depth: number = 8): { proof: string[]; root: string } {
  // Precompute zero hashes
  const zeros: string[] = new Array(depth);
  zeros[0] = ethers.ZeroHash; // bytes32(0)
  for (let i = 1; i < depth; i++) {
    zeros[i] = commutativeKeccak256(zeros[i - 1], zeros[i - 1]);
  }

  // Build proof: for index 0 (leftmost), the sibling at each level is zeros[level].
  const proof: string[] = [];
  let current = leaf;
  for (let i = 0; i < depth; i++) {
    proof.push(zeros[i]);
    current = commutativeKeccak256(current, zeros[i]);
  }

  return { proof, root: current };
}

// ────────────────────────────────────────────────────────────────────────────

describe("Verifier", function () {
  let router: Router;
  let verifier: Verifier;
  let wrappedDemo: WrappedDemo;
  let headerVerifier: MockHeaderVerifier;

  let deployer: SignerWithAddress;
  let sender: SignerWithAddress;
  let recipient: SignerWithAddress;
  let attacker: SignerWithAddress;

  const ONE_ETH = ethers.parseEther("1");
  const DEPTH = 8;

  // Captured from the first initiateRequest call
  let leafHash: string;
  let merkleRoot: string;
  let proof: string[];
  let requestDeadline: bigint;
  const REQUEST_ID = 0n;

  beforeEach(async () => {
    [deployer, sender, recipient, attacker] = await ethers.getSigners();

    // Deploy N1 Router (used to generate consistent leaf/root)
    const Router = await ethers.getContractFactory("Router");
    router = (await Router.deploy()) as Router;
    await router.waitForDeployment();

    // Deploy N2 stack
    const MockHV = await ethers.getContractFactory("MockHeaderVerifier");
    headerVerifier = (await MockHV.deploy()) as MockHeaderVerifier;
    await headerVerifier.waitForDeployment();

    const WrappedDemo = await ethers.getContractFactory("WrappedDemo");
    wrappedDemo = (await WrappedDemo.deploy(deployer.address)) as WrappedDemo;
    await wrappedDemo.waitForDeployment();

    const Verifier = await ethers.getContractFactory("Verifier");
    verifier = (await Verifier.deploy(
      await headerVerifier.getAddress(),
      await wrappedDemo.getAddress()
    )) as Verifier;
    await verifier.waitForDeployment();

    // Transfer WrappedDemo ownership to Verifier
    await wrappedDemo.transferOwnership(await verifier.getAddress());

    // Make a request on N1 so we have a real leaf + root
    const tx = await router
      .connect(sender)
      .initiateRequest(recipient.address, { value: ONE_ETH });
    const receipt = await tx.wait();
    const block = await ethers.provider.getBlock(receipt!.blockNumber);

    const eventLog = receipt!.logs.find(
      (l) => router.interface.parseLog(l)?.name === "RequestCreated"
    );
    const parsed = router.interface.parseLog(eventLog!);
    leafHash = (parsed!.args as unknown as { leaf: string }).leaf;
    requestDeadline = BigInt(block!.timestamp) + BigInt(24 * 3600);

    // Read the root from Router (it stores the cached root)
    merkleRoot = await router.root();

    // Build off-chain proof for leaf index 0
    const built = buildProofForLeafZero(leafHash, DEPTH);
    proof = built.proof;

    // Verify our off-chain root matches the on-chain root
    // (this guards the test helper itself)
    expect(built.root).to.equal(merkleRoot);
  });

  function header(r: string = merkleRoot, sourceBlock: number = 1) {
    return { sourceBlock, root: r };
  }

  function requestData(overrides: Partial<{
    id: bigint; sender: string; recipient: string; value: bigint; deadline: bigint;
  }> = {}) {
    return {
      id: overrides.id ?? REQUEST_ID,
      sender: overrides.sender ?? sender.address,
      recipient: overrides.recipient ?? recipient.address,
      value: overrides.value ?? ONE_ETH,
      deadline: overrides.deadline ?? requestDeadline,
    };
  }

  // ── Happy path ──────────────────────────────────────────────────────────

  it("mints wDEMO on a valid proof and emits Verified", async () => {
    await expect(
      verifier.verifyAndExecute(header(), proof, requestData())
    )
      .to.emit(verifier, "Verified")
      .withArgs(REQUEST_ID, recipient.address, ONE_ETH);

    const balance = await wrappedDemo.balanceOf(recipient.address);
    expect(balance).to.equal(ONE_ETH);
  });

  // ── Tampered proof ──────────────────────────────────────────────────────

  it("reverts on tampered proof (flip first sibling)", async () => {
    const tamperedProof = [...proof];
    tamperedProof[0] = ethers.keccak256(ethers.toUtf8Bytes("garbage"));
    await expect(
      verifier.verifyAndExecute(header(), tamperedProof, requestData())
    ).to.be.revertedWith("Verifier: invalid proof");
  });

  // ── Wrong root ──────────────────────────────────────────────────────────

  it("reverts when header carries a wrong root", async () => {
    const wrongRoot = ethers.keccak256(ethers.toUtf8Bytes("wrong-root"));
    await expect(
      verifier.verifyAndExecute(header(wrongRoot), proof, requestData())
    ).to.be.revertedWith("Verifier: invalid proof");
  });

  // ── Replay ──────────────────────────────────────────────────────────────

  it("reverts on replay (second call with same id)", async () => {
    await verifier.verifyAndExecute(header(), proof, requestData());
    await expect(
      verifier.verifyAndExecute(header(), proof, requestData())
    ).to.be.revertedWith("Verifier: already executed");
  });

  // ── Expired deadline ────────────────────────────────────────────────────

  it("reverts when block.timestamp > deadline", async () => {
    // Advance time past the deadline
    await time.increaseTo(Number(requestDeadline) + 1);
    await expect(
      verifier.verifyAndExecute(header(), proof, requestData())
    ).to.be.revertedWith("Verifier: request expired");
  });

  // ── Tampered request data ────────────────────────────────────────────────

  it("reverts when request data is tampered (different recipient)", async () => {
    // Changing recipient changes the leaf → proof won't match
    await expect(
      verifier.verifyAndExecute(header(), proof, requestData({ recipient: attacker.address }))
    ).to.be.revertedWith("Verifier: invalid proof");
  });

  it("reverts when request data has wrong value", async () => {
    await expect(
      verifier.verifyAndExecute(
        header(), proof,
        requestData({ value: ethers.parseEther("2") })
      )
    ).to.be.revertedWith("Verifier: invalid proof");
  });
});
