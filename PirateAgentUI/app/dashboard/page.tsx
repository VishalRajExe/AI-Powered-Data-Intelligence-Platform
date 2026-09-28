"use client";
import { motion } from "framer-motion";
import {
  CompassIcon,
  ShipWheelIcon,
  CargoIcon,
  LighthouseIcon,
} from "@/components/icons";
import { PromptBox } from "@/components/dashboard/prompt-box";
import { StatCard } from "@/components/dashboard/stat-card";
import { RecentWorkflows } from "@/components/dashboard/recent-workflows";
import { RecentDatasets } from "@/components/dashboard/recent-datasets";
import { useAuth } from "@/lib/auth";
import { useApi } from "@/hooks/use-api";
import { formatNumber } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};
const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" as const } },
};

interface WorkflowListResponse {
  data: Array<{
    id: string;
    name: string;
    prompt: string;
    status: string;
    progress: number;
    validRecords: number;
    updatedAt: string;
    lastRun?: { status: string };
    totalRuns?: number;
  }>;
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

interface DatasetListResponse {
  data: Array<{
    id: string;
    name: string;
    description: string;
    recordCount: number;
    sourceCount: number;
    status: string;
    updatedAt: string;
  }>;
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

export default function DashboardPage() {
  const { user } = useAuth();
  const workspaceId = user?.workspaceId;
  const userId = user?.id;

  const { data: wfData, loading: wfLoading } = useApi<WorkflowListResponse>(
    workspaceId ? "/workflows" : null,
    { workspaceId: workspaceId!, userId: userId!, limit: 10 },
    { skip: !workspaceId },
  );

  const { data: dsData, loading: dsLoading } = useApi<DatasetListResponse>(
    workspaceId ? "/datasets" : null,
    { workspaceId: workspaceId!, userId: userId!, limit: 10 },
    { skip: !workspaceId },
  );

  const workflows = wfData?.data ?? [];
  const datasets = dsData?.data ?? [];

  const totalWorkflows = wfData?.pagination?.total ?? 0;
  const running = workflows.filter((w) => w.status === "ACTIVE" || w.status === "running" || w.lastRun?.status === "RUNNING").length;
  const totalRecords = datasets.reduce((sum, d) => sum + (d.recordCount ?? 0), 0);
  const totalSources = datasets.reduce((sum, d) => sum + (d.sourceCount ?? 0), 0);

  const isLoading = wfLoading || dsLoading;

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={item}>
        <PromptBox />
      </motion.div>

      <motion.div variants={item} className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {isLoading ? (
          <>
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-[88px] rounded-xl" />
            ))}
          </>
        ) : (
          <>
            <StatCard
              icon={CompassIcon}
              label="Total workflows"
              value={formatNumber(totalWorkflows)}
              tone="primary"
            />
            <StatCard
              icon={ShipWheelIcon}
              label="Running now"
              value={formatNumber(running)}
              tone="warning"
            />
            <StatCard
              icon={CargoIcon}
              label="Records collected"
              value={formatNumber(totalRecords)}
              tone="success"
            />
            <StatCard
              icon={LighthouseIcon}
              label="Sources used"
              value={formatNumber(totalSources)}
              tone="default"
            />
          </>
        )}
      </motion.div>

      <motion.div variants={item} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RecentWorkflows workflows={workflows.slice(0, 4)} loading={wfLoading} />
        <RecentDatasets datasets={datasets.slice(0, 4)} loading={dsLoading} />
      </motion.div>
    </motion.div>
  );
}
