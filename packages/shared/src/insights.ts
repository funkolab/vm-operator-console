/**
 * Live infrastructure insights read from Prism Central v4 (read-only):
 * VM performance metrics, placement on hosts, task progress and cluster
 * capacity. These complement the declarative state held by vm-operator.
 */

export const METRIC_RANGES = {
  "1h": { seconds: 3600, interval: 60, label: "Last hour" },
  "6h": { seconds: 6 * 3600, interval: 300, label: "Last 6 hours" },
  "24h": { seconds: 24 * 3600, interval: 900, label: "Last 24 hours" },
  "7d": { seconds: 7 * 24 * 3600, interval: 3600, label: "Last 7 days" },
} as const;
export type MetricRange = keyof typeof METRIC_RANGES;
export const METRIC_RANGE_KEYS = Object.keys(METRIC_RANGES) as MetricRange[];

export interface MetricPoint {
  /** ISO timestamp of the sample. */
  t: string;
  /** Hypervisor CPU usage, 0–100 %. */
  cpu?: number;
  /** Memory usage seen by the hypervisor, 0–100 %. */
  mem?: number;
  /** Memory usage reported by the guest (guest tools), 0–100 %. */
  guestMem?: number;
  /** Storage controller IOPS. */
  iops?: number;
  /** Average storage latency in milliseconds. */
  latencyMs?: number;
  /** Storage read / write bandwidth in KiB/s. */
  readKBps?: number;
  writeKBps?: number;
  /** Network receive / transmit throughput in bytes per second. */
  rxBps?: number;
  txBps?: number;
}

export interface VMMetrics {
  available: boolean;
  message?: string;
  range: MetricRange;
  intervalSeconds: number;
  points: MetricPoint[];
  /** Latest non-empty value of each series. */
  current: Omit<MetricPoint, "t"> & { t?: string };
}

export interface EntityRef {
  extId: string;
  name?: string;
}

export interface VMPlacement {
  available: boolean;
  message?: string;
  extId?: string;
  /** VM name on Nutanix. */
  nutanixName?: string;
  host?: EntityRef & { cpuModel?: string };
  cluster?: EntityRef;
  powerState?: string;
  createTime?: string;
  machineType?: string;
  isLiveMigrateCapable?: boolean;
  project?: EntityRef;
  protectionType?: string;
  /** Prism Central web UI link to the VM. */
  prismUrl?: string;
}

export interface TaskProgress {
  available: boolean;
  message?: string;
  extId?: string;
  status?: "QUEUED" | "RUNNING" | "CANCELING" | "SUCCEEDED" | "FAILED" | "CANCELED" | "SUSPENDED" | string;
  progress?: number;
  operation?: string;
  description?: string;
  createdTime?: string;
  startedTime?: string;
  completedTime?: string;
  errorMessages?: string[];
}

export interface InfraVM {
  extId: string;
  nutanixName: string;
  powerState?: string;
  /** Set when the VM is managed by a VirtualMachine the user can see. */
  managed?: { namespace: string; name: string; displayName: string; phase?: string };
}

export interface InfraHost extends EntityRef {
  cpuModel?: string;
  cores?: number;
  memoryBytes?: number;
  cpuUsage?: number;
  memUsage?: number;
  iops?: number;
  vms: InfraVM[];
}

export interface InfraCluster extends EntityRef {
  nodes: number;
  cpuUsage?: number;
  memUsage?: number;
  memoryCapacityBytes?: number;
  memoryUsedBytes?: number;
  storageCapacityBytes?: number;
  storageUsedBytes?: number;
  vcpusConfigured?: number;
  cpuOvercommit?: number;
  iops?: number;
  latencyMs?: number;
  healthScore?: number;
  hosts: InfraHost[];
  /** VMs without a known host (powered off). */
  unplaced: InfraVM[];
}

export interface Infrastructure {
  available: boolean;
  message?: string;
  context: { namespace: string; name: string; address?: string; pcVersion?: string };
  clusters: InfraCluster[];
  managedCount: number;
  totalVms: number;
  generatedAt: string;
}

export interface ConsumerSample {
  namespace: string;
  name: string;
  displayName: string;
  cpu?: number;
  mem?: number;
  iops?: number;
  /** Recent CPU samples for a sparkline. */
  spark: number[];
}

export interface TopConsumers {
  available: boolean;
  message?: string;
  items: ConsumerSample[];
}

/** Converts parts-per-million to a percentage with one decimal. */
export const ppmToPercent = (ppm?: number) => (ppm === undefined || ppm === null || Number.isNaN(ppm) ? undefined : Math.round(ppm / 1000) / 10);
