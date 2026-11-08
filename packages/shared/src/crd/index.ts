import { z } from "zod";
import { ApiVersions, DNS1035_LABEL } from "../constants";
import { ObjectMetaSchema } from "../k8s";
import {
  NutanixPrismContextSpecSchema,
  NutanixPrismContextStatusSchema,
  VirtualMachineServiceSpecSchema,
  VirtualMachineServiceStatusSchema,
  VirtualMachineSpecSchema,
  VirtualMachineStatusSchema,
} from "./generated";

export { fieldDocs } from "./docs.generated";
export * from "./generated";

export const VirtualMachineSchema = z.looseObject({
  apiVersion: z.literal(ApiVersions.vmm).optional(),
  kind: z.literal("VirtualMachine").optional(),
  metadata: ObjectMetaSchema,
  spec: VirtualMachineSpecSchema,
  status: VirtualMachineStatusSchema.optional(),
});
export type VirtualMachine = z.infer<typeof VirtualMachineSchema>;
export type VirtualMachineSpec = z.infer<typeof VirtualMachineSpecSchema>;
export type VirtualMachineStatus = z.infer<typeof VirtualMachineStatusSchema>;

export const VirtualMachineServiceSchema = z.looseObject({
  apiVersion: z.literal(ApiVersions.vmm).optional(),
  kind: z.literal("VirtualMachineService").optional(),
  metadata: ObjectMetaSchema.extend({
    name: z.string().max(63).regex(DNS1035_LABEL, "Must be a DNS-1035 label (lowercase, starts with a letter)").optional(),
  }),
  spec: VirtualMachineServiceSpecSchema,
  status: VirtualMachineServiceStatusSchema.optional(),
});
export type VirtualMachineService = z.infer<typeof VirtualMachineServiceSchema>;
export type VirtualMachineServiceSpec = z.infer<typeof VirtualMachineServiceSpecSchema>;

export const NutanixPrismContextSchema = z.looseObject({
  apiVersion: z.literal(ApiVersions.prism).optional(),
  kind: z.literal("NutanixPrismContext").optional(),
  metadata: ObjectMetaSchema,
  spec: NutanixPrismContextSpecSchema,
  status: NutanixPrismContextStatusSchema.optional(),
});
export type NutanixPrismContext = z.infer<typeof NutanixPrismContextSchema>;
export type NutanixPrismContextSpec = z.infer<typeof NutanixPrismContextSpecSchema>;

// Convenience aliases for nested spec types.
export type VMCompute = NonNullable<VirtualMachineSpec["compute"]>;
export type VMBootConfiguration = NonNullable<VirtualMachineSpec["bootConfiguration"]>;
export type VMBootDisk = NonNullable<VMBootConfiguration["bootDisk"]>;
export type VMStorage = NonNullable<VirtualMachineSpec["storage"]>;
export type VMDataDisk = NonNullable<VMStorage["dataDisks"]>[number];
export type VMCDRom = NonNullable<VMStorage["cdroms"]>[number];
export type VMNetwork = NonNullable<VirtualMachineSpec["network"]>;
export type VMNic = NonNullable<VMNetwork["nics"]>[number];
export type VMGuestCustomization = NonNullable<VirtualMachineSpec["guestCustomization"]>;
export type VMCategory = NonNullable<VirtualMachineSpec["categories"]>[number];
export type NutanixResourceRef = VirtualMachineSpec["placement"]["cluster"];
export type VMAddress = NonNullable<VirtualMachineStatus["addresses"]>[number];
export type VMDrift = NonNullable<VirtualMachineStatus["drift"]>[number];
export type DiskAdapterType = "SCSI" | "IDE" | "PCI" | "SATA";
export type PowerState = "On" | "Off";
export type VMServicePort = VirtualMachineServiceSpec["ports"][number];
