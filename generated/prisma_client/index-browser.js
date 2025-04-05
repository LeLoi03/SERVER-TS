
Object.defineProperty(exports, "__esModule", { value: true });

const {
  Decimal,
  objectEnumValues,
  makeStrictEnum,
  Public,
  getRuntime,
  skip
} = require('./runtime/index-browser.js')


const Prisma = {}

exports.Prisma = Prisma
exports.$Enums = {}

/**
 * Prisma Client JS version: 6.5.0
 * Query Engine version: 173f8d54f8d52e692c7e27e72a88314ec7aeff60
 */
Prisma.prismaVersion = {
  client: "6.5.0",
  engine: "173f8d54f8d52e692c7e27e72a88314ec7aeff60"
}

Prisma.PrismaClientKnownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientKnownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)};
Prisma.PrismaClientUnknownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientUnknownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientRustPanicError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientRustPanicError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientInitializationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientInitializationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientValidationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientValidationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`sqltag is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.empty = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`empty is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.join = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`join is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.raw = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`raw is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.validator = Public.validator

/**
* Extensions
*/
Prisma.getExtensionContext = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.getExtensionContext is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.defineExtension = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.defineExtension is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}

/**
 * Shorthand utilities for JSON filtering
 */
Prisma.DbNull = objectEnumValues.instances.DbNull
Prisma.JsonNull = objectEnumValues.instances.JsonNull
Prisma.AnyNull = objectEnumValues.instances.AnyNull

Prisma.NullTypes = {
  DbNull: objectEnumValues.classes.DbNull,
  JsonNull: objectEnumValues.classes.JsonNull,
  AnyNull: objectEnumValues.classes.AnyNull
}



/**
 * Enums
 */

exports.Prisma.TransactionIsolationLevel = makeStrictEnum({
  ReadUncommitted: 'ReadUncommitted',
  ReadCommitted: 'ReadCommitted',
  RepeatableRead: 'RepeatableRead',
  Serializable: 'Serializable'
});

exports.Prisma.LocationsScalarFieldEnum = {
  id: 'id',
  address: 'address',
  cityStateProvince: 'cityStateProvince',
  country: 'country',
  continent: 'continent',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  isAvailable: 'isAvailable',
  organizeId: 'organizeId'
};

exports.Prisma.ConferenceDatesScalarFieldEnum = {
  id: 'id',
  organizedId: 'organizedId',
  fromDate: 'fromDate',
  toDate: 'toDate',
  type: 'type',
  name: 'name',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  isAvailable: 'isAvailable'
};

exports.Prisma.ConferenceOrganizationsScalarFieldEnum = {
  id: 'id',
  year: 'year',
  accessType: 'accessType',
  isAvailable: 'isAvailable',
  conferenceId: 'conferenceId',
  publisher: 'publisher',
  summerize: 'summerize',
  callForPaper: 'callForPaper',
  link: 'link',
  cfpLink: 'cfpLink',
  impLink: 'impLink',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ConferenceTopicsScalarFieldEnum = {
  id: 'id',
  organizeId: 'organizeId',
  topicId: 'topicId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.TopicsScalarFieldEnum = {
  id: 'id',
  name: 'name',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ConferencesScalarFieldEnum = {
  id: 'id',
  title: 'title',
  acronym: 'acronym',
  creatorId: 'creatorId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  status: 'status'
};

exports.Prisma.ConferenceRanksScalarFieldEnum = {
  id: 'id',
  year: 'year',
  conferenceId: 'conferenceId',
  fieldOfResearchId: 'fieldOfResearchId',
  rankId: 'rankId'
};

exports.Prisma.FieldOfResearchsScalarFieldEnum = {
  id: 'id',
  name: 'name',
  code: 'code'
};

exports.Prisma.RanksScalarFieldEnum = {
  id: 'id',
  name: 'name',
  value: 'value',
  sourceId: 'sourceId'
};

exports.Prisma.SourcesScalarFieldEnum = {
  id: 'id',
  name: 'name',
  link: 'link'
};

exports.Prisma.JournalTopicsScalarFieldEnum = {
  id: 'id',
  journalId: 'journalId',
  topicId: 'topicId'
};

exports.Prisma.JournalRanksScalarFieldEnum = {
  id: 'id',
  year: 'year',
  journalId: 'journalId',
  fieldOfResearchId: 'fieldOfResearchId',
  rankId: 'rankId'
};

exports.Prisma.JournalsScalarFieldEnum = {
  id: 'id',
  name: 'name',
  issn: 'issn',
  hIndex: 'hIndex',
  publisher: 'publisher',
  nation: 'nation',
  scope: 'scope',
  emailSubmission: 'emailSubmission',
  creator: 'creator'
};

exports.Prisma.ConferenceFollowsScalarFieldEnum = {
  id: 'id',
  conferenceId: 'conferenceId',
  userId: 'userId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ConferenceLikesScalarFieldEnum = {
  id: 'id',
  conferenceId: 'conferenceId',
  userId: 'userId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ConferenceFeedbacksScalarFieldEnum = {
  id: 'id',
  conferenceId: 'conferenceId',
  creatorId: 'creatorId',
  description: 'description',
  star: 'star',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ConferenceCalendarsScalarFieldEnum = {
  id: 'id',
  conferenceId: 'conferenceId',
  userId: 'userId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.JournalLikesScalarFieldEnum = {
  id: 'id',
  journalId: 'journalId',
  userId: 'userId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.JournalFollowsScalarFieldEnum = {
  id: 'id',
  journalId: 'journalId',
  userId: 'userId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.UsersScalarFieldEnum = {
  id: 'id',
  email: 'email',
  password: 'password',
  firstName: 'firstName',
  lastName: 'lastName',
  dob: 'dob',
  avatar: 'avatar',
  aboutMe: 'aboutMe',
  background: 'background',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ConferenceCrawlJobsScalarFieldEnum = {
  id: 'id',
  conferenceId: 'conferenceId',
  status: 'status',
  progress: 'progress',
  message: 'message',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ConferenceBlacklistsScalarFieldEnum = {
  id: 'id',
  conferenceId: 'conferenceId',
  userId: 'userId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.JournalCrawlJobsScalarFieldEnum = {
  id: 'id',
  journalId: 'journalId',
  status: 'status',
  progress: 'progress',
  message: 'message',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.NotificationsScalarFieldEnum = {
  id: 'id',
  notificationId: 'notificationId',
  userId: 'userId',
  message: 'message',
  isRead: 'isRead',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.NotificationsTypesScalarFieldEnum = {
  id: 'id',
  name: 'name',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.NotificationSettingsScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  notificationId: 'notificationId',
  isEnabled: 'isEnabled',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.TopicUserInterestedsScalarFieldEnum = {
  userId: 'userId',
  topicId: 'topicId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.UserVerificationScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  verificationCode: 'verificationCode',
  verificationCodeExpires: 'verificationCodeExpires',
  isVerified: 'isVerified',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SortOrder = {
  asc: 'asc',
  desc: 'desc'
};

exports.Prisma.QueryMode = {
  default: 'default',
  insensitive: 'insensitive'
};

exports.Prisma.NullsOrder = {
  first: 'first',
  last: 'last'
};


exports.Prisma.ModelName = {
  Locations: 'Locations',
  ConferenceDates: 'ConferenceDates',
  ConferenceOrganizations: 'ConferenceOrganizations',
  ConferenceTopics: 'ConferenceTopics',
  Topics: 'Topics',
  Conferences: 'Conferences',
  ConferenceRanks: 'ConferenceRanks',
  FieldOfResearchs: 'FieldOfResearchs',
  Ranks: 'Ranks',
  Sources: 'Sources',
  JournalTopics: 'JournalTopics',
  JournalRanks: 'JournalRanks',
  Journals: 'Journals',
  ConferenceFollows: 'ConferenceFollows',
  ConferenceLikes: 'ConferenceLikes',
  ConferenceFeedbacks: 'ConferenceFeedbacks',
  ConferenceCalendars: 'ConferenceCalendars',
  JournalLikes: 'JournalLikes',
  JournalFollows: 'JournalFollows',
  Users: 'Users',
  ConferenceCrawlJobs: 'ConferenceCrawlJobs',
  ConferenceBlacklists: 'ConferenceBlacklists',
  JournalCrawlJobs: 'JournalCrawlJobs',
  Notifications: 'Notifications',
  NotificationsTypes: 'NotificationsTypes',
  NotificationSettings: 'NotificationSettings',
  TopicUserInteresteds: 'TopicUserInteresteds',
  UserVerification: 'UserVerification'
};

/**
 * This is a stub Prisma Client that will error at runtime if called.
 */
class PrismaClient {
  constructor() {
    return new Proxy(this, {
      get(target, prop) {
        let message
        const runtime = getRuntime()
        if (runtime.isEdge) {
          message = `PrismaClient is not configured to run in ${runtime.prettyName}. In order to run Prisma Client on edge runtime, either:
- Use Prisma Accelerate: https://pris.ly/d/accelerate
- Use Driver Adapters: https://pris.ly/d/driver-adapters
`;
        } else {
          message = 'PrismaClient is unable to run in this browser environment, or has been bundled for the browser (running in `' + runtime.prettyName + '`).'
        }
        
        message += `
If this is unexpected, please open an issue: https://pris.ly/prisma-prisma-bug-report`

        throw new Error(message)
      }
    })
  }
}

exports.PrismaClient = PrismaClient

Object.assign(exports, Prisma)
