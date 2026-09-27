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
} finally {
  await prisma.$disconnect();
}
