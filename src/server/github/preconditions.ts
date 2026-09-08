export type ProjectMutationReadback = {
  nodeId: string;
  number: number;
  public: boolean;
  repository: string;
  labels: string[];
  fields: Record<string, string[]>;
};

export type ProjectMutationExpectation = {
  expectedRepository: string;
  expectedProject: { nodeId: string; number: number };
  requiredLabels: string[];
  requiredFields: { status: string; priority: string; impact: string; effort: string };
};

export type MergeTargetReadback = {
  nodeId: string;
  number: number;
  repository: string;
  state: "OPEN" | "CLOSED";
  status: string | null;
};

export function assertProjectPreconditions(expected: ProjectMutationExpectation, actual: ProjectMutationReadback): void {
  if (actual.nodeId !== expected.expectedProject.nodeId || actual.number !== expected.expectedProject.number) {
    throw new Error("GitHub Project identity drifted from the registered target");
  }
  if (actual.public) throw new Error("GitHub Project is no longer private");
  if (actual.repository !== expected.expectedRepository) throw new Error("GitHub repository mapping drifted from the registered target");
  for (const label of expected.requiredLabels) {
    if (!actual.labels.includes(label)) throw new Error(`Required governed label ${label} is missing`);
  }
  const requiredOptions: Record<string, string> = {
    Status: expected.requiredFields.status,
    Priority: expected.requiredFields.priority,
    Impact: expected.requiredFields.impact,
    Effort: expected.requiredFields.effort,
  };
  for (const [field, option] of Object.entries(requiredOptions)) {
    if (!actual.fields[field]?.includes(option)) throw new Error(`GitHub Project field ${field} no longer permits ${option}`);
  }
}

export function assertMergePreconditions(expectedRepository: string, target: MergeTargetReadback | null): void {
  if (!target) throw new Error("Merge target is missing or inaccessible");
  if (target.repository !== expectedRepository) throw new Error("Merge target repository drifted from the registered target");
  if (target.state !== "OPEN") throw new Error("Merge target is not open");
  if (target.status === "Done") throw new Error("Merge target moved to Done");
  if (!target.status) throw new Error("Merge target has no governed Project Status");
}
