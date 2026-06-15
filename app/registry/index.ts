/**
 * Registry handling all components (registries, triggers, watchers).
 */
import logger from '../log';
const log = logger.child({ component: 'registry' });
import {
    getWatcherConfigurations,
    getTriggerConfigurations,
    getRegistryConfigurations,
    getAuthenticationConfigurations,
} from '../configuration';
import Component, { ComponentConfiguration } from './Component';
import Trigger from '../triggers/providers/Trigger';
import Watcher from '../watchers/Watcher';
import Registry from '../registries/Registry';
import Authentication from '../authentications/providers/Authentication';

// Static provider map — avoids dynamic import() path resolution issues
const PROVIDERS: Record<string, Record<string, () => Promise<any>>> = {
    authentication: {
        anonymous: () => import('../authentications/providers/anonymous/Anonymous'),
        basic:     () => import('../authentications/providers/basic/Basic'),
        oidc:      () => import('../authentications/providers/oidc/Oidc'),
    },
    watcher: {
        docker: () => import('../watchers/providers/docker/Docker'),
    },
    trigger: {
        apprise:       () => import('../triggers/providers/apprise/Apprise'),
        command:       () => import('../triggers/providers/command/Command'),
        discord:       () => import('../triggers/providers/discord/Discord'),
        docker:        () => import('../triggers/providers/docker/Docker'),
        dockercompose: () => import('../triggers/providers/dockercompose/Dockercompose'),
        gotify:        () => import('../triggers/providers/gotify/Gotify'),
        http:          () => import('../triggers/providers/http/Http'),
        ifttt:         () => import('../triggers/providers/ifttt/Ifttt'),
        kafka:         () => import('../triggers/providers/kafka/Kafka'),
        mock:          () => import('../triggers/providers/mock/Mock'),
        mqtt:          () => import('../triggers/providers/mqtt/Hass'),
        ntfy:          () => import('../triggers/providers/ntfy/Ntfy'),
        pushover:      () => import('../triggers/providers/pushover/Pushover'),
        rocketchat:    () => import('../triggers/providers/rocketchat/Rocketchat'),
        slack:         () => import('../triggers/providers/slack/Slack'),
        smtp:          () => import('../triggers/providers/smtp/Smtp'),
        telegram:      () => import('../triggers/providers/telegram/Telegram'),
    },
    registry: {
        acr:       () => import('../registries/providers/acr/Acr'),
        codeberg:  () => import('../registries/providers/codeberg/Codeberg'),
        custom:    () => import('../registries/providers/custom/Custom'),
        ecr:       () => import('../registries/providers/ecr/Ecr'),
        forgejo:   () => import('../registries/providers/forgejo/Forgejo'),
        gcr:       () => import('../registries/providers/gcr/Gcr'),
        ghcr:      () => import('../registries/providers/ghcr/Ghcr'),
        gitea:     () => import('../registries/providers/gitea/Gitea'),
        gitlab:    () => import('../registries/providers/gitlab/Gitlab'),
        hub:       () => import('../registries/providers/hub/Hub'),
        lscr:      () => import('../registries/providers/lscr/Lscr'),
        quay:      () => import('../registries/providers/quay/Quay'),
        trueforge: () => import('../registries/providers/trueforge/Trueforge'),
    },
};

export interface RegistryState {
    trigger: { [key: string]: Trigger };
    watcher: { [key: string]: Watcher };
    registry: { [key: string]: Registry };
    authentication: { [key: string]: Authentication };
}

type ComponentKind = keyof RegistryState;

/**
 * Registry state.
 */
const state: RegistryState = {
    trigger: {},
    watcher: {},
    registry: {},
    authentication: {},
};

export function getState() {
    return state;
}

/**
 * Get available providers for a given component kind.
 * @param {string} kind component kind
 * @returns {string[]} sorted list of available provider names
 */
function getAvailableProviders(kind: ComponentKind) {
    return Object.keys(PROVIDERS[kind] || {}).sort();
}

/**
 * Get documentation link for a component kind.
 * @param {string} kind component kind (trigger, watcher, etc.)
 * @returns {string} documentation path
 */
function getDocumentationLink(kind: ComponentKind) {
    const docLinks: Record<ComponentKind, string> = {
        trigger:
            'https://github.com/getwud/wud/tree/main/docs/configuration/triggers',
        watcher:
            'https://github.com/getwud/wud/tree/main/docs/configuration/watchers',
        registry:
            'https://github.com/getwud/wud/tree/main/docs/configuration/registries',
        authentication:
            'https://github.com/getwud/wud/tree/main/docs/configuration/authentications',
    };
    return (
        docLinks[kind] ||
        'https://github.com/getwud/wud/tree/main/docs/configuration'
    );
}

/**
 * Build error message when a component provider is not found.
 * @param {string} kind component kind (trigger, watcher, etc.)
 * @param {string} provider the provider name that was not found
 * @param {string} error the original error message
 * @param {string[]} availableProviders list of available providers
 * @returns {string} formatted error message
 */
function getHelpfulErrorMessage(
    kind: ComponentKind,
    provider: string,
    error: string,
    availableProviders: string[],
) {
    let message = `Error when registering component ${provider} (${error})`;

    if (error.includes('Cannot find module')) {
        const kindDisplay = kind.charAt(0).toUpperCase() + kind.slice(1);
        const envVarPattern = `WUD_${kindDisplay.toUpperCase()}_${provider.toUpperCase()}_*`;

        message = `Unknown ${kind} provider: '${provider}'.`;
        message += `\n  (Check your environment variables - this comes from: ${envVarPattern})`;

        if (availableProviders.length > 0) {
            message += `\n  Available ${kind} providers: ${availableProviders.join(', ')}`;
            const docLink = getDocumentationLink(kind);
            message += `\n  For more information, visit: ${docLink}`;
        }
    }

    return message;
}

/**
 * Register a component.
 *
 * @param {*} kind
 * @param {*} provider
 * @param {*} name
 * @param {*} configuration
 */
async function registerComponent(
    kind: ComponentKind,
    provider: string,
    name: string,
    configuration: ComponentConfiguration,
): Promise<Component> {
    const providerLowercase = provider.toLowerCase();
    const nameLowercase = name.toLowerCase();
    const loader = PROVIDERS[kind]?.[providerLowercase];
    if (!loader) {
        const available = getAvailableProviders(kind);
        const helpfulMessage = getHelpfulErrorMessage(
            kind,
            providerLowercase,
            'Cannot find module',
            available,
        );
        throw new Error(helpfulMessage);
    }
    try {
        const ComponentClass = (await loader()).default;
        const component: Component = new ComponentClass();
        const componentRegistered = await component.register(
            kind,
            providerLowercase,
            nameLowercase,
            configuration,
        );
        (state[kind] as any)[component.getId()] = component;
        return componentRegistered;
    } catch (e: any) {
        throw new Error(
            `Error when registering component ${providerLowercase} (${e.message})`,
        );
    }
}

/**
 * Register all found components.
 * @param kind
 * @param configurations
 * @returns {*[]}
 */
async function registerComponents(
    kind: ComponentKind,
    configurations: Record<string, any>,
) {
    if (configurations) {
        const providers = Object.keys(configurations);
        const providerPromises = providers
            .map((provider) => {
                log.info(
                    `Register all components of kind ${kind} for provider ${provider}`,
                );
                const providerConfigurations = configurations[provider];
                return Object.keys(providerConfigurations).map(
                    (configurationName) =>
                        registerComponent(
                            kind,
                            provider,
                            configurationName,
                            providerConfigurations[configurationName],
                        ),
                );
            })
            .flat();
        return Promise.all(providerPromises);
    }
    return [];
}

/**
 * Register watchers.
 * @returns {Promise}
 */
async function registerWatchers() {
    const configurations = getWatcherConfigurations();
    let watchersToRegister: Promise<any>[] = [];
    try {
        if (Object.keys(configurations).length === 0) {
            log.info(
                'No Watcher configured => Init a default one (Docker with default options)',
            );
            watchersToRegister.push(
                registerComponent(
                    'watcher',
                    'docker',
                    'local',
                    {},
                ),
            );
        } else {
            watchersToRegister = watchersToRegister.concat(
                Object.keys(configurations).map((watcherKey) => {
                    const watcherKeyNormalize = watcherKey.toLowerCase();
                    return registerComponent(
                        'watcher',
                        'docker',
                        watcherKeyNormalize,
                        configurations[watcherKeyNormalize],
                    );
                }),
            );
        }
        await Promise.all(watchersToRegister);
    } catch (e: any) {
        log.warn(`Some watchers failed to register (${e.message})`);
        log.debug(e);
    }
}

/**
 * Register triggers.
 */
async function registerTriggers() {
    const configurations = getTriggerConfigurations();
    try {
        await registerComponents(
            'trigger',
            configurations,
        );
    } catch (e: any) {
        log.warn(`Some triggers failed to register (${e.message})`);
        log.debug(e);
    }
}

/**
 * Register registries.
 * @returns {Promise}
 */
async function registerRegistries() {
    const defaultRegistries = {
        codeberg: { public: '' },
        ecr: { public: '' },
        forgejo: { public: '' },
        gcr: { public: '' },
        ghcr: { public: '' },
        hub: { public: '' },
        quay: { public: '' },
    };
    const registriesToRegister = {
        ...defaultRegistries,
        ...getRegistryConfigurations(),
    };

    try {
        await registerComponents(
            'registry',
            registriesToRegister,
        );
    } catch (e: any) {
        log.warn(`Some registries failed to register (${e.message})`);
        log.debug(e);
    }
}

/**
 * Register authentications.
 */
async function registerAuthentications() {
    const configurations = getAuthenticationConfigurations();
    try {
        if (Object.keys(configurations).length === 0) {
            log.info('No authentication configured => Allow anonymous access');
            await registerComponent(
                'authentication',
                'anonymous',
                'anonymous',
                {},
            );
        }
        await registerComponents(
            'authentication',
            configurations,
        );
    } catch (e: any) {
        log.warn(`Some authentications failed to register (${e.message})`);
        log.debug(e);
    }
}

/**
 * Deregister a component.
 * @param component
 * @param kind
 * @returns {Promise}
 */
async function deregisterComponent(component: Component, kind: ComponentKind) {
    try {
        await component.deregister();
    } catch (e: any) {
        throw new Error(
            `Error when deregistering component ${component.getId()} (${e.message})`,
        );
    } finally {
        const components = getState()[kind];
        if (components) {
            delete components[component.getId()];
        }
    }
}

/**
 * Deregister all components of kind.
 * @param components
 * @param kind
 * @returns {Promise}
 */
async function deregisterComponents(
    components: Component[],
    kind: ComponentKind,
) {
    const deregisterPromises = components.map(async (component) =>
        deregisterComponent(component, kind),
    );
    return Promise.all(deregisterPromises);
}

/**
 * Deregister all watchers.
 * @returns {Promise}
 */
async function deregisterWatchers() {
    return deregisterComponents(Object.values(getState().watcher), 'watcher');
}

/**
 * Deregister all triggers.
 * @returns {Promise}
 */
async function deregisterTriggers() {
    return deregisterComponents(Object.values(getState().trigger), 'trigger');
}

/**
 * Deregister all registries.
 * @returns {Promise}
 */
async function deregisterRegistries() {
    return deregisterComponents(Object.values(getState().registry), 'registry');
}

/**
 * Deregister all authentications.
 * @returns {Promise<unknown>}
 */
async function deregisterAuthentications() {
    return deregisterComponents(
        Object.values(getState().authentication),
        'authentication',
    );
}

/**
 * Deregister all components.
 * @returns {Promise}
 */
async function deregisterAll() {
    try {
        await deregisterWatchers();
        await deregisterTriggers();
        await deregisterRegistries();
        await deregisterAuthentications();
    } catch (e: any) {
        throw new Error(`Error when trying to deregister ${e.message}`);
    }
}

export async function init() {
    // Register triggers
    await registerTriggers();

    // Register registries
    await registerRegistries();

    // Register watchers
    await registerWatchers();

    // Register authentications
    await registerAuthentications();

    // Gracefully exit when possible
    process.on('SIGINT', deregisterAll);
    process.on('SIGTERM', deregisterAll);
}

// The following exports are meant for testing only
export {
    registerComponent as testable_registerComponent,
    registerComponents as testable_registerComponents,
    registerRegistries as testable_registerRegistries,
    registerTriggers as testable_registerTriggers,
    registerWatchers as testable_registerWatchers,
    registerAuthentications as testable_registerAuthentications,
    deregisterComponent as testable_deregisterComponent,
    deregisterRegistries as testable_deregisterRegistries,
    deregisterTriggers as testable_deregisterTriggers,
    deregisterWatchers as testable_deregisterWatchers,
    deregisterAuthentications as testable_deregisterAuthentications,
    deregisterAll as testable_deregisterAll,
    log as testable_log,
};
