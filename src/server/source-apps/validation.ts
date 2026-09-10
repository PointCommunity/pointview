export type Registration = {
  githubOwner: string;
  githubRepo: string;
  installationId: number;
  projectNodeId: string;
  projectNumber: number;
  governedLabels: string[];
};

export type TargetReadback = {
  repository: { owner: string; name: string; private: boolean; installationId: number };
  project: {
    nodeId: string;
    number: number;
    private: boolean;
    fields: Record<string, string[]>;
  };
  labels: string[];
};

const requiredFields: Record<string, string[]> = {
  Status: ["Backlog", "On Hold", "In Progress", "In Review", "Done"],
  Priority: ["P0", "P1", "P2", "P3"],
  Impact: ["High", "Medium", "Low"],
  Effort: ["XS", "S", "M", "L", "XL"],
};

export function validateSourceTarget(registration: Registration, readback: TargetReadback) {
  const errors: string[] = [];
  if (readback.repository.owner !== registration.githubOwner || readback.repository.name !== registration.githubRepo) {
    errors.push("repository identity does not match registration");
  }
  if (readback.repository.installationId !== registration.installationId) errors.push("GitHub installation does not match");
  if (!readback.project.private) errors.push("Project must be private");
  if (readback.project.nodeId !== registration.projectNodeId || readback.project.number !== registration.projectNumber) {
    errors.push("Project identity does not match registration");
  }
  for (const [field, options] of Object.entries(requiredFields)) {
    if (JSON.stringify(readback.project.fields[field]) !== JSON.stringify(options)) {
      errors.push(`${field} options do not match governed values`);
    }
  }
  const availableLabels = new Set(readback.labels);
  for (const label of registration.governedLabels) {
    if (!availableLabels.has(label)) errors.push(`required label ${label} is missing`);
  }
  const typeLabels = new Set(registration.governedLabels.filter((label) => label.startsWith("type:")));
  const areaLabels = registration.governedLabels.filter((label) => label.startsWith("area:"));
  for (const required of ["type:bug", "type:feature", "type:maintenance", "type:security"]) {
    if (!typeLabels.has(required)) errors.push(`governed type label ${required} is missing`);
  }
  if (areaLabels.length < 1) errors.push("governed mapping must contain at least one area label");
  return { valid: errors.length === 0, errors };
}
