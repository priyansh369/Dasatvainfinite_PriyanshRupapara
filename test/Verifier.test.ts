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
// OZ's MerkleTree uses commutativeKeccak256: hash(a, b) = keccak256(sort(a, b))
// lexicographically.  We replicate that here to build proofs without an extra library.
//
// This also lets us assert that TS root == Router.root() for every test.

function commutativeKeccak256(a: string, b: string): string {
  // Sort lexicographically, same as OZ Hashes.commutativeKeccak256
  const [lo, hi] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  return ethers.keccak256(ethers.concat([lo, hi]));
}

/**
 * Build a depth-8 Merkle proof for a single leaf at index 0.
 *
 * OZ initialises the tree with `zero = bytes32(0)`.
 * Zero values for each level:  z[0] = 0x00…00, z[i] = H(z[i-1], z[i-1]).
 *
 * For the first (and only) leaf at index 0 the sibling at every level is the
 * zero-hash for that depth.
 *
 * Returns both the proof path and the expected root so the test can verify
 * TS root === Router.root().
 */
function buildProofForLeafZero(leaf: string, depth = 8): { proof: string[]; root: string } {
  // Pre-compute zero hashes
  const zeros: string[] = new Array(depth);
  zeros[0] = ethers.ZeroHash; // bytes32(0)
  for (let i = 1; i < depth; i++) {
    zeros[i] = commutativeKeccak256(zeros[i - 1], zeros[i - 1]);
  }

  // Build proof: for index 0, the sibling at each level is the zero for that level.
  const proof: string[] = [];
  let current = leaf;
  for (let i = 0; i < depth; i++) {
    proof.push(zeros[i]);
    current = commutativeKeccak256(current, zeros[i]);
  }

  return { proof, root: current };
}

// ─────────────────────────────────────────────────────────────────────────────

const TTL   = 3600;   // matches Router constructor in tests
const GRACE = 600;
const DEPTH = 8;

describe("Verifier", function () {
  let router: Router;
  let verifier: Verifier;
  let wrappedDemo: WrappedDemo;
  let headerVerifier: MockHeaderVerifier;

  let deployer:  SignerWithAddress;
  let sender:    SignerWithAddress;
  let recipient: SignerWithAddress;
  let attacker:  SignerWithAddress;

  const ONE_ETH = ethers.parseEther("1");

  // Captured from the first initiateRequest call
  let leafHash:        string;
  let merkleRoot:      string;
  let proof:           string[];
  let requestDeadline: bigint;
  let routerAddress:   string;
  let chainId:         bigint;

  const REQUEST_ID = 0n;

  beforeEach(async () => {
    [deployer, sender, recipient, attacker] = await ethers.getSigners();
    chainId = (await ethers.provider.getNetwork()).chainId;

    // ── Deploy N1 Router ────────────────────────────────────────────────────
    const RouterFactory = await ethers.getContractFactory("Router");
    router = (await RouterFactory.deploy(TTL, GRACE)) as Router;
    await router.waitForDeployment();
    routerAddress = await router.getAddress();

    // ── Deploy N2 stack ─────────────────────────────────────────────────────
    const MockHV = await ethers.getContractFactory("MockHeaderVerifier");
    headerVerifier = (await MockHV.deploy()) as MockHeaderVerifier;
    await headerVerifier.waitForDeployment();

    const WrappedDemoFactory = await ethers.getContractFactory("WrappedDemo");
    wrappedDemo = (await WrappedDemoFactory.deploy(deployer.address)) as WrappedDemo;
    await wrappedDemo.waitForDeployment();

    const VerifierFactory = await ethers.getContractFactory("Verifier");
    verifier = (await VerifierFactory.deploy(
      await wrappedDemo.getAddress(),
      await headerVerifier.getAddress(),
      chainId,          // sourceChainId — same chain in local tests
      routerAddress     // sourceRouter
    )) as Verifier;
    await verifier.waitForDeployment();

    // Give Verifier the minting role (one-time setMinter)
    await wrappedDemo.connect(deployer).setMinter(await verifier.getAddress());

    // ── Make one request on N1 ─────────────────────────────────────────────
    const tx      = await router.connect(sender).initiateRequest(recipient.address, { value: ONE_ETH });
    const receipt = await tx.wait();
    const block   = await ethers.provider.getBlock(receipt!.blockNumber);

    // Parse event to get leaf + deadline
    const eventLog = receipt!.logs.find(
      (l) => router.interface.parseLog(l)?.name === "RequestCreated"
    );
    const parsed = router.interface.parseLog(eventLog!);
    leafHash        = (parsed!.args as any).leaf     as string;
    requestDeadline = (parsed!.args as any).deadline as bigint;

    // Read root from Router
    merkleRoot = await router.root();

    // Build off-chain proof for leaf index 0
    const built = buildProofForLeafZero(leafHash, DEPTH);
    proof = built.proof;

    // Critical sanity check: TS root must equal the on-chain root
    expect(built.root).to.equal(
      merkleRoot,
      "TS incremental Merkle root does not match Router.root() — leaf encoding mismatch"
    );
  });

  // ── Helpers ──────────────────────────────────────────────────────────────

  function makeHeader(r: string = merkleRoot, sourceBlock = 1) {
    return { sourceBlock, root: r };
  }

  function makeRequest(overrides: Partial<{
    id: bigint; sender: string; recipient: string; amount: bigint; deadline: bigint;
  }> = {}) {
    return {
      id:        overrides.id        ?? REQUEST_ID,
      sender:    overrides.sender    ?? sender.address,
      recipient: overrides.recipient ?? recipient.address,
      amount:    overrides.amount    ?? ONE_ETH,
      deadline:  overrides.deadline  ?? requestDeadline,
    };
  }

  // ── Happy path ───────────────────────────────────────────────────────────

  it("mints wDETH on a valid proof and emits Verified", async () => {
    await expect(
      verifier.verifyAndExecute(makeHeader(), proof, makeRequest())
    )
      .to.emit(verifier, "Verified")
      .withArgs(REQUEST_ID, recipient.address, ONE_ETH, 1);

    expect(await wrappedDemo.balanceOf(recipient.address)).to.equal(ONE_ETH);
  });

  it("marks the request as processed after execution", async () => {
    await verifier.verifyAndExecute(makeHeader(), proof, makeRequest());
    expect(await verifier.processed(REQUEST_ID)).to.be.true;
  });

  // ── Tampered amount ──────────────────────────────────────────────────────

  it("reverts when request amount is tampered", async () => {
    await expect(
      verifier.verifyAndExecute(makeHeader(), proof, makeRequest({ amount: ethers.parseEther("2") }))
    ).to.be.revertedWithCustomError(verifier, "InvalidProof");
  });

  // ── Wrong root ───────────────────────────────────────────────────────────

  it("reverts when header carries a wrong root", async () => {
    const wrongRoot = ethers.keccak256(ethers.toUtf8Bytes("wrong-root"));
    await expect(
      verifier.verifyAndExecute(makeHeader(wrongRoot), proof, makeRequest())
    ).to.be.revertedWithCustomError(verifier, "InvalidProof");
  });

  // ── Tampered proof ───────────────────────────────────────────────────────

  it("reverts when proof sibling is tampered", async () => {
    const tamperedProof = [...proof];
    tamperedProof[0] = ethers.keccak256(ethers.toUtf8Bytes("garbage"));
    await expect(
      verifier.verifyAndExecute(makeHeader(), tamperedProof, makeRequest())
    ).to.be.revertedWithCustomError(verifier, "InvalidProof");
  });

  // ── Replay ───────────────────────────────────────────────────────────────

  it("reverts on replay (same id submitted twice)", async () => {
    await verifier.verifyAndExecute(makeHeader(), proof, makeRequest());
    await expect(
      verifier.verifyAndExecute(makeHeader(), proof, makeRequest())
    ).to.be.revertedWithCustomError(verifier, "AlreadyProcessed");
  });

  // ── Expired deadline ─────────────────────────────────────────────────────

  it("reverts when block.timestamp > deadline (expired)", async () => {
    await time.increaseTo(Number(requestDeadline) + 1);
    await expect(
      verifier.verifyAndExecute(makeHeader(), proof, makeRequest())
    ).to.be.revertedWithCustomError(verifier, "Expired");
  });

  // ── Tampered recipient ───────────────────────────────────────────────────

  it("reverts when recipient is tampered (different address changes leaf)", async () => {
    await expect(
      verifier.verifyAndExecute(makeHeader(), proof, makeRequest({ recipient: attacker.address }))
    ).to.be.revertedWithCustomError(verifier, "InvalidProof");
  });

  // ── Reclaim edge-cases (cross-contract, via Router) ──────────────────────

  it("reclaim reverts before deadline + reclaimGrace (too early)", async () => {
    // Advance to just before grace expires
    await time.increaseTo(Number(requestDeadline) + GRACE - 60);
    await expect(
      router.connect(sender).reclaim(REQUEST_ID)
    ).to.be.revertedWith("Router: too early to reclaim");
  });

  it("reclaim succeeds after deadline + reclaimGrace", async () => {
    await time.increaseTo(Number(requestDeadline) + GRACE + 1);
    // At this point verifyAndExecute would also revert with Expired, so no dual-spend risk
    const balBefore = await ethers.provider.getBalance(sender.address);
    const tx        = await router.connect(sender).reclaim(REQUEST_ID);
    const receipt   = await tx.wait();
    const gas       = receipt!.gasUsed * receipt!.gasPrice;
    const balAfter  = await ethers.provider.getBalance(sender.address);
    expect(balAfter).to.be.closeTo(balBefore + ONE_ETH - gas, ethers.parseEther("0.0001"));
  });

  it("reclaim reverts if caller is not the original sender", async () => {
    await time.increaseTo(Number(requestDeadline) + GRACE + 1);
    await expect(
      router.connect(attacker).reclaim(REQUEST_ID)
    ).to.be.revertedWith("Router: not sender");
  });
});
