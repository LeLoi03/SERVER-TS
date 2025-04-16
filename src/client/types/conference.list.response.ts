export type ConferenceListResponse = {
  payload: ConferenceInfo[];
  meta: Meta;
};

export type ConferenceInfo = {
  id: string;
  title: string;
  acronym: string;
  location: Location | null;
  rank: string | null;
  source: string | null;
  year: number | null;
  researchFields: string;
  topics: string[];
  dates: ImportantDates | null;
  link: string | null;
  publisher: string | null;
  createdAt: string;
  updatedAt: string;
  creatorId: string;
  accessType: string | null;
  status: string;
  isLessReputable?: boolean; // <-- ADD THIS LINE

};

export type Location = {
  cityStateProvince: string | null;
  country: string | null;
  address: string | null;
  continent: string | null;
};




export type ImportantDates = {
  name: string;
  type: string;
  fromDate: string;
  toDate: string;
} | null;
//Nếu dates không bao giờ là null, mà là một array có thể chứa các object null, thì ImportantDates[] là đủ

export type Meta = {
  curPage: number;
  perPage: number;
  totalPage: number;
  prevPage: number | null;
  nextPage: number | null;
  totalItems: number;
};