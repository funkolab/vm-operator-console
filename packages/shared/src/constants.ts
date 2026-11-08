export const CONSOLE_DOMAIN = "console.nutanix.com";

export const Labels = {
  type: `${CONSOLE_DOMAIN}/type`,
  template: `${CONSOLE_DOMAIN}/template`,
  managed: `${CONSOLE_DOMAIN}/managed`,
  os: `${CONSOLE_DOMAIN}/os`,
} as const;

export const LabelValues = {
  vmTemplate: "vm-template",
  prismCredential: "prism-credential",
  prismCABundle: "prism-ca-bundle",
  guestCustomization: "guest-customization",
} as const;

export const Annotations = {
  displayName: `${CONSOLE_DOMAIN}/display-name`,
  description: `${CONSOLE_DOMAIN}/description`,
  tags: `${CONSOLE_DOMAIN}/tags`,
  createdBy: `${CONSOLE_DOMAIN}/created-by`,
  updatedBy: `${CONSOLE_DOMAIN}/updated-by`,
  sourceTemplate: `${CONSOLE_DOMAIN}/source-template`,
  sourceTemplateVersion: `${CONSOLE_DOMAIN}/source-template-version`,
  clonedFrom: `${CONSOLE_DOMAIN}/cloned-from`,
  restartPending: `${CONSOLE_DOMAIN}/restart-pending`,
  // vm-operator annotations
  paused: "infra.nutanix.com/paused",
  allowDiskDeletion: "vmm.v4.nutanix.com/allow-disk-deletion",
  allowBootDiskDeletion: "vmm.v4.nutanix.com/allow-boot-disk-deletion",
  recoverByBiosUUID: "vmm.v4.nutanix.com/recover-by-bios-uuid",
  recoveredByBiosUUID: "vmm.v4.nutanix.com/recovered-by-bios-uuid",
  requestIdPrefix: "vmm.v4.nutanix.com/request-id-",
} as const;

export const ApiVersions = {
  vmm: "vmm.v4.nutanix.com/v1alpha1",
  prism: "prism.v4.nutanix.com/v1alpha1",
} as const;

export const ConditionTypes = {
  ready: "Ready",
  contextBound: "ContextBound",
  resourcesResolved: "ResourcesResolved",
  provisioned: "Provisioned",
  synchronized: "Synchronized",
  drifted: "Drifted",
  powerStateReconciled: "PowerStateReconciled",
  addressReady: "AddressReady",
  nicAddressesObserved: "NICAddressesObserved",
  deleting: "Deleting",
  connected: "Connected",
  endpointsResolved: "EndpointsResolved",
  probesDegraded: "ProbesDegraded",
} as const;

/** Canonical condition display order, mirrored from vm-operator internal/common/conditions.go. */
export const VirtualMachineConditionOrder = [
  "Ready",
  "ContextBound",
  "ResourcesResolved",
  "Provisioned",
  "Synchronized",
  "Drifted",
  "PowerStateReconciled",
  "AddressReady",
  "NICAddressesObserved",
  "Deleting",
];

export const DNS1123_SUBDOMAIN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
export const DNS1123_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
export const DNS1035_LABEL = /^[a-z]([-a-z0-9]*[a-z0-9])?$/;
export const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export const NUTANIX_NAME_RE = /^[a-zA-Z0-9_][a-zA-Z0-9 _\-.]*$/;
