import { randomUUID } from "node:crypto";

type ProblemInput = {
  status: number;
  title: string;
  code: string;
  detail?: string;
};

const safeCorrelationId = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;

export function withCorrelationId(headers: Headers): string {
  const candidate = headers.get("x-correlation-id");
  return candidate && safeCorrelationId.test(candidate) ? candidate : randomUUID();
}

export function problem(input: ProblemInput, correlationId: string): Response {
  const slug = input.code.toLowerCase().replaceAll("_", "-");
  return Response.json(
    {
      type: `https://view.pointatx.org/problems/${slug}`,
      title: input.title,
      status: input.status,
      code: input.code,
      ...(input.detail ? { detail: input.detail } : {}),
      correlationId,
    },
    {
      status: input.status,
      headers: {
        "content-type": "application/problem+json",
        "cache-control": "no-store",
        "x-correlation-id": correlationId,
      },
    },
  );
}

