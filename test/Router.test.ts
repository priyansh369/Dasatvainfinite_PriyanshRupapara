import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { Router } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// ── Constants matching deploy-n1.ts ──────────────────────────────────────────
const TTL   = 3600;       // 1 hour  (requestTtl)
const GRACE = 600;        // 10 min  (reclaimGrace)

describe("Router", function () {
  let router: Router;
  let owner: SignerWithAddress;
  let sender: SignerWithAddress;
  let recipient: SignerWithAddress;
  let other: SignerWithAddress;

  const ONE_ETH = ethers.parseEther("1");

  beforeEach(async () => {
    [owner, sender, recipient, other] = await ethers.getSigners();
    const RouterFactory = await ethers.getContractFactory("Router");
    router = (await RouterFactory.deploy(TTL, GRACE)) as Router;
    await router.waitForDeployment();
  });

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Parse a RequestCreated log from a transaction receipt. */
  async function getRequestCreatedArgs(txHash: string) {
    const receipt = await ethers.provider.getTransactionReceipt(txHash);
    const block   = await ethers.provider.getBlock(receipt!.blockNumber);
    const eventLog = receipt!.logs.find(
      (l) => router.interface.parseLog(l)?.name === "RequestCreated"
    );
    const parsed = router.interface.parseLog(eventLog!);
    return {
      id:        (parsed!.args as any).id        as bigint,
      sender_:   (parsed!.args as any).sender    as string,
      recipient_:(parsed!.args as any).recipient as string,
      amount:    (parsed!.args as any).amount    as bigint,
      deadline:  (parsed!.args as any).deadline  as bigint,
      leaf:      (parsed!.args as any).leaf      as string,
      newRoot:   (parsed!.args as any).newRoot   as string,
      index:     (parsed!.args as any).index     as bigint,
      blockTs:   BigInt(block!.timestamp),
    };
  }

  // ── initiateRequest ─────────────────────────────────────────────────────────

  describe("initiateRequest", () => {
    it("locks ETH, emits RequestCreated with correct leaf, and root() reflects the push", async () => {
      const tx = await router
        .connect(sender)
        .initiateRequest(recipient.address, { value: ONE_ETH });
      const { id, sender_, recipient_, amount, deadline, leaf, newRoot, index, blockTs } =
        await getRequestCreatedArgs(tx.hash);

      expect(id).to.equal(0n);
      expect(sender_).to.equal(sender.address);
      expect(recipient_).to.equal(recipient.address);
      expect(amount).to.equal(ONE_ETH);
      expect(index).to.equal(0n);

      // Deadline should be blockTimestamp + TTL
      expect(deadline).to.equal(blockTs + BigInt(TTL));

      // Recompute leaf: keccak256(abi.encode(chainid, router, id, sender, recipient, amount, deadline))
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const routerAddr = await router.getAddress();
      const expectedLeaf = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "address", "uint256", "address", "address", "uint256", "uint256"],
          [chainId, routerAddr, 0n, sender.address, recipient.address, ONE_ETH, deadline]
        )
      );
      expect(leaf).to.equal(expectedLeaf);

      // root() should equal the emitted newRoot
      expect(await router.root()).to.equal(newRoot);

      // ETH locked in the contract
      expect(await ethers.provider.getBalance(routerAddr)).to.equal(ONE_ETH);
    });

    it("increments id and index on successive calls", async () => {
      const tx0 = await router.connect(sender).initiateRequest(recipient.address, { value: ONE_ETH });
      const a0  = await getRequestCreatedArgs(tx0.hash);
      expect(a0.id).to.equal(0n);
      expect(a0.index).to.equal(0n);

      const tx1 = await router.connect(sender).initiateRequest(recipient.address, { value: ONE_ETH });
      const a1  = await getRequestCreatedArgs(tx1.hash);
      expect(a1.id).to.equal(1n);
      expect(a1.index).to.equal(1n);
    });

    it("reverts when sending zero ETH", async () => {
      await expect(
        router.connect(sender).initiateRequest(recipient.address, { value: 0 })
      ).to.be.revertedWith("Router: must send ETH");
    });

    it("root() changes after each push", async () => {
      const root0 = await router.root();
      await router.connect(sender).initiateRequest(recipient.address, { value: ONE_ETH });
      const root1 = await router.root();
      expect(root1).to.not.equal(root0);

      await router.connect(sender).initiateRequest(recipient.address, { value: ONE_ETH });
      const root2 = await router.root();
      expect(root2).to.not.equal(root1);
    });

    it("nextId increments correctly", async () => {
      expect(await router.nextId()).to.equal(0n);
      await router.connect(sender).initiateRequest(recipient.address, { value: ONE_ETH });
      expect(await router.nextId()).to.equal(1n);
    });
  });

  // ── reclaim ──────────────────────────────────────────────────────────────────

  describe("reclaim", () => {
    let requestId: bigint;
    let deadline: bigint;

    beforeEach(async () => {
      const tx = await router
        .connect(sender)
        .initiateRequest(recipient.address, { value: ONE_ETH });
      const args = await getRequestCreatedArgs(tx.hash);
      requestId = args.id;
      deadline  = args.deadline;
    });

    it("reverts if called before deadline + reclaimGrace", async () => {
      // Advance to just before deadline + GRACE
      await time.increaseTo(Number(deadline) + GRACE - 60);
      await expect(
        router.connect(sender).reclaim(requestId)
      ).to.be.revertedWith("Router: too early to reclaim");
    });

    it("reverts if caller is not the original sender", async () => {
      await time.increaseTo(Number(deadline) + GRACE + 1);
      await expect(
        router.connect(other).reclaim(requestId)
      ).to.be.revertedWith("Router: not sender");
    });

    it("refunds ETH to sender after deadline + reclaimGrace", async () => {
      await time.increaseTo(Number(deadline) + GRACE + 1);

      const balanceBefore = await ethers.provider.getBalance(sender.address);
      const tx      = await router.connect(sender).reclaim(requestId);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const balanceAfter = await ethers.provider.getBalance(sender.address);

      expect(balanceAfter).to.be.closeTo(
        balanceBefore + ONE_ETH - gasUsed,
        ethers.parseEther("0.0001")
      );
    });

    it("reverts on double reclaim (replay guard)", async () => {
      await time.increaseTo(Number(deadline) + GRACE + 1);
      await router.connect(sender).reclaim(requestId);
      await expect(
        router.connect(sender).reclaim(requestId)
      ).to.be.revertedWith("Router: already reclaimed");
    });

    it("reverts for unknown id", async () => {
      await expect(
        router.connect(sender).reclaim(999n)
      ).to.be.revertedWith("Router: unknown id");
    });
  });
});
