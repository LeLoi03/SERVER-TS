export type ConferenceResponse = {
  conference: ConferenceIdentity;
  organization: Organization;
  location: Location | null;
  dates: ImportantDate[] | null;
  ranks: Rank[] | null;
  feedBacks: Feedback[] | null;
  followedBy: FollowerInfo[] | null;
  isLessReputable?: boolean; // <-- ADD THIS LINE

};

export type ConferenceIdentity = {
  id: string;
  title: string | null;
  acronym: string | null;
  creatorId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type Organization = {
  id: string;
  year: number | null;
  accessType: string | null;
  isAvailable: boolean | null;
  conferenceId: string | null;
  summerize: string | null;
  callForPaper: string | null;
  publisher: string | null;
  link: string | null;
  cfpLink: string | null;
  impLink: string | null;
  topics: string[] | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ImportantDate = {
  id: string;
  organizedId: string | null;
  fromDate: string | null;
  toDate: string | null;
  type: string | null;
  name: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  isAvailable: boolean | null;
} | null;

export type Location = {
  id: string;
  address: string | null;
  cityStateProvince: string | null;
  country: string | null;
  continent: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  isAvailable: boolean | null;
  organizeId: string | null;
};

export type Rank = {
  rank: string;
  source: string | null;
  fieldOfResearch: string | null;
};

export type Feedback = {
  id: string;
  organizedId: string;
  creatorId: string;
  firstName: string;
  lastName: string;
  avatar: string;
  description: string;
  star: number;
  createdAt: string;
  updatedAt: string;
};

export type FollowerInfo = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  avatar: string;
  createdAt: string | null;
  updatedAt: string | null;
};