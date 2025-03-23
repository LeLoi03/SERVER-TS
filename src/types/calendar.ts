import { ZodNullableDef } from "zod";

export type CalendarEvent = {
    day: number;
    month: number; // 1-indexed (January is 1, December is 12)
    year: number;
    type: string | null;
    conference: string | null; // Store the full conference title/acronym
    conferenceId: string; // Add conferenceId for easier lookup
  };