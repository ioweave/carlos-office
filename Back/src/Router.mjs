export default class Router {
    constructor(routes = []) {
        this.routes = routes;
    }

    matchPath(routePath, requestPath) {
        const routeParts = routePath.split('/').filter(Boolean);
        const requestParts = requestPath.split('/').filter(Boolean);
        if (routeParts.length !== requestParts.length) return false;

        return routeParts.every((part, index) => (
            part.startsWith('{') && part.endsWith('}')
                ? true
                : part === requestParts[index]
        ));
    }

    extractParams(routePath, requestPath) {
        const routeParts = routePath.split('/').filter(Boolean);
        const requestParts = requestPath.split('/').filter(Boolean);
        const params = {};

        routeParts.forEach((part, index) => {
            if (part.startsWith('{') && part.endsWith('}')) {
                params[part.slice(1, -1)] = decodeURIComponent(requestParts[index] || '');
            }
        });

        return params;
    }

    async handle(method, requestPath, data = {}) {
        const [path, queryString = ''] = requestPath.split('?');
        const route = this.routes.find(item => (
            item.method === method && this.matchPath(item.path, path)
        ));

        if (!route) return { statusCode: 404, body: { error: 'Not found' } };

        const params = this.extractParams(route.path, path);
        const query = Object.fromEntries(new URLSearchParams(queryString));

        try {
            return await route.handler({ ...data, params, query, path, method });
        } catch (error) {
            console.error('[office] route error', error);
            return {
                statusCode: error.statusCode || 500,
                body: { error: error.message || 'Internal server error' },
            };
        }
    }
}
