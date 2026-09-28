import { PrismaClient, UserStatus, WorkspaceRole, WorkspaceStatus } from "@prisma/client";

if (process.env.APP_ENV === "production") {
  throw new Error("Development seed data cannot be applied when APP_ENV=production");
}

const prisma = new PrismaClient();

try {
  const user = await prisma.user.upsert({
    where: { email: "developer@example.invalid" },
    update: { name: "Development User", status: UserStatus.ACTIVE },
    create: {
      email: "developer@example.invalid",
      name: "Development User",
      status: UserStatus.ACTIVE,
    },
  });

  const workspace = await prisma.workspace.upsert({
    where: { slug: "development" },
    update: { name: "Development Workspace", status: WorkspaceStatus.ACTIVE },
    create: {
      slug: "development",
      name: "Development Workspace",
      createdById: user.id,
    },
  });

  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
    update: { role: WorkspaceRole.OWNER },
    create: { workspaceId: workspace.id, userId: user.id, role: WorkspaceRole.OWNER },
  });

  console.info("Development user and workspace are ready.");

  // Also seed demo@pirateagent.ai for instant login in PirateAgentUI
  const { hashPassword } = await import("../src/modules/auth/password.js");
  const demoPasswordHash = await hashPassword("Demo1234!");

  const demoUser = await prisma.user.upsert({
    where: { email: "demo@pirateagent.ai" },
    update: { name: "Captain Demo", passwordHash: demoPasswordHash, status: UserStatus.ACTIVE },
    create: {
      email: "demo@pirateagent.ai",
      name: "Captain Demo",
      passwordHash: demoPasswordHash,
      status: UserStatus.ACTIVE,
    },
  });

  const demoWorkspace = await prisma.workspace.upsert({
    where: { slug: "demo-crew" },
    update: { name: "Demo Crew Workspace", status: WorkspaceStatus.ACTIVE },
    create: {
      slug: "demo-crew",
      name: "Demo Crew Workspace",
      createdById: demoUser.id,
    },
  });

  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: demoWorkspace.id, userId: demoUser.id } },
    update: { role: WorkspaceRole.OWNER },
    create: { workspaceId: demoWorkspace.id, userId: demoUser.id, role: WorkspaceRole.OWNER },
  });

  console.info("Demo user (demo@pirateagent.ai / Demo1234!) is ready.");
} finally {
  await prisma.$disconnect();
}
