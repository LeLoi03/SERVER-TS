export type CalendarEvent = {
    day: number;
    month: number; // 1-indexed (January is 1, December is 12)
    year: number;
    type: string;
    conference: string; // Store the full conference title/acronym
    conferenceId: string; // Add conferenceId for easier lookup
  };