import { NextResponse } from "next/server";

export const jsonResponse = (data: unknown, init?: ResponseInit) => {
  return NextResponse.json(data, init);
};

export const errorResponse = (message: string, status = 500) => {
  return NextResponse.json({ error: message }, { status });
};
