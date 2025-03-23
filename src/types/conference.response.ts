export type ConferenceResponse = {
  conference: ConferenceIdentity;
  organization: Organization;
  locations: Location | null;
  dates: ImportantDate[] | null;
  rankSourceFoRData: Rank[] | null;
  feedBacks: Feedback[] | null;
  follower: FollowerInfo[] | null;
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
  summary: string | null;
  callForPaper: string | null;
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
  researchFields: string | null;
};

export type Feedback = {
  id: string;
  organizedId: string | null;
  creatorId: string | null;
  description: string | null;
  star: number | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type FollowerInfo = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};


