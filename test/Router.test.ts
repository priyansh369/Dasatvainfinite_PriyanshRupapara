import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { Router } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Router", function () {
  let router: Router;
  let owner: SignerWithAddress;
  let sender: SignerWithAddress;
  let recipient: SignerWithAddress;
  let other: SignerWithAddress;

  const ONE_ETH = ethers.parseEther("1");

  beforeEach(async () => {
    [owner, sender, recipient, other] = await ethers.getSigners();
    const Router = await ethers.getContractFactory("Router");
    router = (await Router.deploy()) as Router;
    await router.waitForDeployment();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // initiateRequest
  // ────────────────────────────────────────────────────────────────────────────

  describe("initiateRequest", () => {
    it("locks ETH and emits RequestCreated with correct leaf", async () => {
      const tx = await router
        .connect(sender)
        .initiateRequest(recipient.address, { value: ONE_ETH });

      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      // Decode event
      const event = receipt!.logs.find(
        (l) => router.interface.parseLog(l)?.name === "RequestCreated"
      );
      const parsed = router.interface.parseLog(event!);
      const { id, leaf, sender: evtSender, recipient: evtRecipient, value, deadline } =
        parsed!.args as unknown as {
          id: bigint;
          leaf: string;
          sender: string;
          recipient: string;
          value: bigint;
          deadline: bigint;
        };

      expect(id).to.equal(0n);
      expect(evtSender).to.equal(sender.address);
      expect(evtRecipient).to.equal(recipient.address);
      expect(value).to.equal(ONE_ETH);

      // Deadline should be ~24 h from block timestamp
      const expectedDeadline = BigInt(block!.timestamp) + BigInt(24 * 3600);
      expect(deadline).to.equal(expectedDeadline);

      // Recompute leaf and verify it matches
      const expectedLeaf = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "address", "address", "uint256", "uint256"],
          [0n, sender.address, recipient.address, ONE_ETH, deadline]
        )
      );
      expect(leaf).to.equal(expectedLeaf);

      // ETH is locked in the contract
      const balance = await ethers.provider.getBalance(await router.getAddress());
      expect(balance).to.equal(ONE_ETH);
    });

    it("increments id on successive calls", async () => {
      const tx0 = await router
        .connect(sender)
        .initiateRequest(recipient.address, { value: ONE_ETH });
      const r0 = await tx0.wait();
      const e0 = router.interface.parseLog(r0!.logs.find((l) => router.interface.parseLog(l)?.name === "RequestCreated")!);
      expect((e0!.args as unknown as { id: bigint }).id).to.equal(0n);

      const tx1 = await router
        .connect(sender)
        .initiateRequest(recipient.address, { value: ONE_ETH });
      const r1 = await tx1.wait();
      const e1 = router.interface.parseLog(r1!.logs.find((l) => router.interface.parseLog(l)?.name === "RequestCreated")!);
      expect((e1!.args as unknown as { id: bigint }).id).to.equal(1n);
    });

    it("reverts when sending zero ETH", async () => {
      await expect(
        router.connect(sender).initiateRequest(recipient.address, { value: 0 })
      ).to.be.revertedWith("Router: must send ETH");
    });

    it("reverts for zero recipient", async () => {
      await expect(
        router.connect(sender).initiateRequest(ethers.ZeroAddress, { value: ONE_ETH })
      ).to.be.revertedWith("Router: zero recipient");
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
  });

  // ────────────────────────────────────────────────────────────────────────────
  // reclaim
  // ────────────────────────────────────────────────────────────────────────────

  describe("reclaim", () => {
    let requestId: bigint;
    let deadline: bigint;

    beforeEach(async () => {
      const tx = await router
        .connect(sender)
        .initiateRequest(recipient.address, { value: ONE_ETH });
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);
      const event = receipt!.logs.find(
        (l) => router.interface.parseLog(l)?.name === "RequestCreated"
      );
      const parsed = router.interface.parseLog(event!);
      requestId = (parsed!.args as unknown as { id: bigint }).id;
      deadline = BigInt(block!.timestamp) + BigInt(24 * 3600);
    });

    it("reverts if called before deadline + 1 hour", async () => {
      // Advance to just before deadline + 1 h
      await time.increaseTo(Number(deadline) + 3600 - 60);
      await expect(
        router.connect(sender).reclaim(requestId)
      ).to.be.revertedWith("Router: too early to reclaim");
    });

    it("reverts if caller is not the original sender", async () => {
      await time.increaseTo(Number(deadline) + 3600 + 1);
      await expect(
        router.connect(other).reclaim(requestId)
      ).to.be.revertedWith("Router: not sender");
    });

    it("refunds ETH to sender after deadline + 1 hour", async () => {
      await time.increaseTo(Number(deadline) + 3600 + 1);

      const balanceBefore = await ethers.provider.getBalance(sender.address);
      const tx = await router.connect(sender).reclaim(requestId);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const balanceAfter = await ethers.provider.getBalance(sender.address);

      expect(balanceAfter).to.be.closeTo(
        balanceBefore + ONE_ETH - gasUsed,
        ethers.parseEther("0.0001") // tolerance for gas estimation
      );
    });

    it("reverts on double reclaim", async () => {
      await time.increaseTo(Number(deadline) + 3600 + 1);
      await router.connect(sender).reclaim(requestId);
      await expect(
        router.connect(sender).reclaim(requestId)
      ).to.be.revertedWith("Router: already reclaimed");
    });
  });
});
