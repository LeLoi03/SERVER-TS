// File ConferenceListResponse:

export type ConferenceListResponse = {
  payload: ConferenceInfo[];
  meta: Meta;
};

export type ConferenceInfo = {
  id: string;
  title: string;
  acronym: string;
  location: Location;  // Defined a separate type for Location
  year: number;
  rankSourceFoRData: RankSourceFoRData; // Defined a separate type
  topics: string[];
  dates: ImportantDates;
  link: string;
  createdAt: string; // Keep as string (ISO 8601)
  updatedAt: string; // Keep as string (ISO 8601)
  creatorId: string;
  accessType: string; //  "Offline" | "Online" | "Hybrid";  //  more specific type
};

export type Location = {
  cityStateProvince: string;
  country: string;
  address: string;
  continent: string;
};

export type RankSourceFoRData = {
  rank: string;
  source: string;
  researchFields: string;  // Changed to string, assuming it's a single field or comma-separated.  If it *must* be an array, change back to string[].
};

export type ImportantDates = {
  name: string;
  type: string;
  fromDate: string;  // Keep as string (ISO 8601)
  toDate: string;    // Keep as string (ISO 8601)
};

export type Meta = {
  curPage: number;
  perPage: number;
  totalPage: number;
  prevPage: number | null; // Changed to number | null
  nextPage: number | null;
  totalItems: number;
};