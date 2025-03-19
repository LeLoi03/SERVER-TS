export type ConferenceResponse = {
  conference: ConferenceIdentity;
  organization: Organization;
  locations: Location;
  dates: ImportantDate[];
  rankSourceFoRData: Rank[];
  feedBacks: Feedback[];
  followedBy: FollowerInfo[];
};

export type ConferenceIdentity = {
  id: string;
  title: string;
  acronym: string;
  creatorId: string;
  createdAt: string;
  updatedAt: string;
};

export type Organization = {
  id: string;
  year: number;
  accessType: string;
  isAvailable: boolean;
  conferenceId: string;
  summary: string;
  callForPaper: string;
  link: string;
  cfpLink: string;
  impLink: string;
  topics: string[];
  createdAt: string;
  updatedAt: string;
};

export type ImportantDate = {
  id: string;
  organizedId: string;
  fromDate: string;
  toDate: string;
  type: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  isAvailable: boolean;
};

export type Location = {
  id: string;
  address: string;
  cityStateProvince: string;
  country: string;
  continent: string;
  createdAt: string;
  updatedAt: string;
  isAvailable: boolean;
  organizeId: string;
};

export type Rank = {
  rank: string;
  source: string;
  researchFields: string;
};

export type Feedback = {
  id: string;
  organizedId: string;
  creatorId: string;
  description: string;
  star: number;
  createdAt: string;
  updatedAt: string;
};

export type FollowerInfo = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: string;
  updatedAt: string;
};


