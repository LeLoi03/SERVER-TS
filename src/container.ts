// src/container.ts
import 'reflect-metadata'; // Essential for Tsyringe to work with decorators (e.g., @injectable, @singleton)
import { container } from 'tsyringe'; // The main IoC container instance

// --- Core Application Services and Configurations ---
// These services typically form the foundation of the application,
// handling configuration, logging, and common utilities.
import { ConfigService } from './config/config.service';
import { LoggingService } from './services/logging.service';
import { ApiKeyManager } from './services/apiKey.manager';
import { PlaywrightService } from './services/playwright.service';
import { FileSystemService } from './services/fileSystem.service';
import { TaskQueueService } from './services/taskQueue.service';

// --- Gemini API Service and its Specialized Sub-Services ---
// This group comprises services dedicated to interacting with the Gemini API,
// including client management, caching, rate limiting, and response handling.
import { GeminiApiService } from './services/geminiApi.service'; // The main facade for Gemini API interactions
import { GeminiClientManagerService } from './services/gemini/geminiClientManager.service';
import { GeminiCachePersistenceService } from './services/gemini/geminiCachePersistence.service';
import { GeminiContextCacheService } from './services/gemini/geminiContextCache.service';
import { GeminiRateLimiterService } from './services/gemini/geminiRateLimiter.service';
import { GeminiModelOrchestratorService } from './services/gemini/geminiModelOrchestrator.service';
import { GeminiResponseHandlerService } from './services/gemini/geminiResponseHandler.service';

// --- Batch Processing Feature Services ---
// This section defines services involved in the multi-step batch processing workflow.
// Includes child services for specific tasks and an orchestrator service.
import { PageContentExtractorService, IPageContentExtractorService } from './services/batchProcessingServiceChild/pageContentExtractor.service';
import { ConferenceLinkProcessorService, IConferenceLinkProcessorService } from './services/batchProcessingServiceChild/conferenceLinkProcessor.service';
import { ConferenceDeterminationService, IConferenceDeterminationService } from './services/batchProcessingServiceChild/conferenceDetermination.service';
import { ConferenceDataAggregatorService, IConferenceDataAggregatorService } from './services/batchProcessingServiceChild/conferenceDataAggregator.service';
import { BatchProcessingService } from './services/batchProcessing.service'; // The orchestrating service for batch processing

// --- Other General Application Services ---
// A collection of other distinct services that handle various application concerns.
import { HtmlPersistenceService } from './services/htmlPersistence.service';
import { ResultProcessingService } from './services/resultProcessing.service';
import { ConferenceProcessorService } from './services/conferenceProcessor.service';
import { CrawlOrchestratorService } from './services/crawlOrchestrator.service';
import { DatabasePersistenceService } from './services/databasePersistence.service';

/**
 * Configure the Tsyringe IoC container by registering all application services.
 * Services are registered either as singletons (one instance per application lifecycle)
 * or as transient (a new instance each time they are resolved).
 *
 * @remarks
 * Using `registerSingleton` is appropriate for stateless services, shared resources (like config, logger),
 * or services managing application-wide state.
 * Using `register` (transient scope) is suitable for services that need a fresh instance for each request
 * or task, or if they hold mutable state specific to a short-lived operation.
 */

// --- 1. Register Core Application Services ---
// These services are typically stateless or manage global application state,
// making them ideal candidates for singleton registration.
container.registerSingleton(ConfigService);
container.registerSingleton(LoggingService);
container.registerSingleton(ApiKeyManager);
container.registerSingleton(PlaywrightService);
container.registerSingleton(FileSystemService);
container.registerSingleton(TaskQueueService);

// --- 2. Register Gemini API Service and its Dependencies ---
// The sub-services of Gemini API are also registered as singletons, as they manage
// shared resources (clients, cache, rate limiters) across all Gemini API calls.
// The main GeminiApiService depends on these sub-services.
// Explicit registration is generally good practice for clarity, even if @singleton decorator is used.
container.registerSingleton(GeminiClientManagerService);
container.registerSingleton(GeminiCachePersistenceService);
container.registerSingleton(GeminiContextCacheService);
container.registerSingleton(GeminiRateLimiterService);
container.registerSingleton(GeminiModelOrchestratorService);
container.registerSingleton(GeminiResponseHandlerService);
container.registerSingleton(GeminiApiService); // The main facade, typically depends on the above sub-services

// --- 3. Register Batch Processing Sub-Services and the Orchestrator ---
// Sub-services are registered using their interface tokens to enable dependency inversion
// and easier testing/mocking. They are usually singletons if their state is application-wide.
container.registerSingleton<IPageContentExtractorService>('IPageContentExtractorService', PageContentExtractorService);
container.registerSingleton<IConferenceLinkProcessorService>('IConferenceLinkProcessorService', ConferenceLinkProcessorService);
container.registerSingleton<IConferenceDeterminationService>('IConferenceDeterminationService', ConferenceDeterminationService);
container.registerSingleton<IConferenceDataAggregatorService>('IConferenceDataAggregatorService', ConferenceDataAggregatorService);

// The main BatchProcessingService orchestrates the flow and depends on the above registered sub-services.
container.registerSingleton(BatchProcessingService);

// --- 4. Register Other General Application Services ---
container.registerSingleton(HtmlPersistenceService);
container.registerSingleton(ResultProcessingService);

// ConferenceProcessorService:
// If this service manages state specific to a single conference processing task or
// needs to be instantiated fresh for each use, `container.register` (transient scope) is appropriate.
// If it's stateless and reusable across tasks, `registerSingleton` could be considered.
// Your original code uses `container.register` which defaults to transient.
container.register(ConferenceProcessorService, ConferenceProcessorService); // Registers as transient scope (new instance each time resolved)

container.registerSingleton(CrawlOrchestratorService);
container.registerSingleton(DatabasePersistenceService);

/**
 * Exports the configured Tsyringe container instance.
 * While direct `container.resolve()` calls can be used, it's often preferred
 * to use `@inject` decorators for constructor injection where possible.
 * This export might be used in `server.ts` or other entry points to resolve
 * the initial set of services (e.g., `ConfigService`, `LoggingService`).
 * @returns {typeof container} The configured Tsyringe container instance.
 */
export default container;