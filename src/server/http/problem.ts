import { randomUUID } from "node:crypto";

type ProblemInput = {
  status: number;
  title: string;
  code: string;
  detail?: string;
};

const safeCorrelationId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
