import axios, { AxiosError, AxiosResponse } from 'axios';

import {
    QueryResult,
    Metric,
    Target,
    RuleGroup,
    Alert,
    TargetState,
    SerieSelector,
} from './types';

export type PrometheusConnectionAuth = {
    username: string;
    password: string;
}

export type PrometheusConnectionProxy = {
    host: string;
    port: number;
}

export class PrometheusConnectionOptions {
    endpoint: string;
    baseURL?: string = '/api/v1/';
    headers?: object = {};
    auth?: PrometheusConnectionAuth = null;
    proxy?: PrometheusConnectionProxy = null;
    withCredentials?: boolean = false;
    timeout?: number = 10000;    // ms
    warningHook?: (any) => any = null;
}

// export class PrometheusConnectionOptions {
//     constructor(
//         endpoint: string,
//         baseURL: string = '/api/v1/',
//         headers: object = {},
//         auth: PrometheusConnectionAuth = null,
//         proxy: PrometheusConnectionProxy = null,
//         withCredentials: boolean = false,
//         timeout: number = 10000,    // ms
//         warningHook: (any) => any = null,
//     ) { }
// }

export type PrometheusQueryDate = Date | number;

export class PrometheusDriver {

    private options: PrometheusConnectionOptions;

    /**
     * Creates a PrometheusDriver client
     * `options` has the following fields:
     *      - endpoint: address of Prometheus instance
     *      - baseURL: base path of Prometheus API (default: /api/v1)
     *      - headers: headers to be sent (k/v format)
     *      - auth: {username: 'foo', password: 'bar'}: basic auth
     *      - proxy: {host: '127.0.0.1', port: 9000}: hostname and port of a proxy server
     *      - withCredentials: indicates whether or not cross-site Access-Control requests
     *      - timeout: number of milliseconds before the request times out
     *      - warningHook: a hook for handling warning messages
     * @param {*} options
     */
    constructor(options: PrometheusConnectionOptions) {
        options = options || new PrometheusConnectionOptions();
        if (!options.endpoint)
            throw 'Endpoint is required';

        options.endpoint = options.endpoint.replace(/\/$/, '');
        options.baseURL = options.baseURL || '/api/v1/';
        options.withCredentials = options.withCredentials || false;
        options.timeout = options.timeout || 10000;

        this.options = options;
    }

    private request<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', uri: string, params?: object, body?: object): Promise<T> {
        const req = axios.request({
            baseURL: this.options.endpoint + this.options.baseURL,
            url: uri,
            method: method,
            params: params,
            data: body,
            headers: this.options.headers,
            auth: (!!this.options.auth?.username && !!this.options.auth?.password) ? {
                username: this.options.auth.username,
                password: this.options.auth.password
            } : null,
            proxy: (!!this.options.proxy?.host && !!this.options.proxy?.port) ? {
                host: this.options.proxy?.host,
                port: this.options.proxy?.port
            } : null,
            withCredentials: this.options.withCredentials,
            timeout: this.options.timeout,
        });
        return req
            .then((res: AxiosResponse<T>) => this.handleResponse<T>(res))
            .catch((res) => this.handleResponse<T>(res));
    }

    private handleResponse<T>(response: AxiosResponse<any> | AxiosError<any>): Promise<T> {
        const err: boolean = (response as any).isAxiosError || false;
        if (err)
            response = (response as AxiosError).response;

        if (!response)
            throw {
                status: 'error',
                errorType: 'unexpected_error',
                error: 'unexpected http error',
            };

        if (!!this.options.warningHook && !!response['warnings'] && response['warnings'].length > 0)
            this.options.warningHook(response['warnings']);

        const data = (response as any).data;
        if (!data || data.status == null)
            throw {
                status: 'error',
                errorType: 'client_error',
                error: 'unexpected client error',
            };

        if (err)
            throw response;

        // deserialize to QueryResult when necessary
        // if (typeof (data) == 'object' && !!data['data'] && !!data['data']['resultType'])
        //     return QueryResult.fromJSON(data['data']);
        return data['data'];
    }

    private formatTimeToPrometheus(input: PrometheusQueryDate | null, dEfault?: PrometheusQueryDate): number {
        if (!input)
            input = dEfault;

        if (typeof (input) == 'number')
            return input / 1000;
        else if (typeof (input) == 'object' && input?.constructor?.name == 'Date')
            return input.getTime() / 1000;
        throw new Error('Wrong time format. Expected number or Date.');
    }

    // @DEPRECATED
    // static metricToReadable(metric) {
    //     const name = !!metric['__name__'] ? metric['__name__'] : '';
    //     const labels = Object.assign({}, metric);

    //     // renders readable serie name and labels
    //     delete labels['__name__'];
    //     const strLabels = Object.keys(labels).map((curr) => curr + '="' + labels[curr] + '"');
    //     return name + '{' + strLabels.join(', ') + '}';
    // }

    /***********************  EXPRESSION QUERIES  ***********************/

    /**
     * Evaluates an instant query at a single point in time
     * @param {*} query Prometheus expression query string.
     * @param {*} time Evaluation Date object or number in milliseconds. Optional.
     */
    public instantQuery(query: string, time?: PrometheusQueryDate): Promise<QueryResult> {
        const params = {
            query: query,
            time: this.formatTimeToPrometheus(time, new Date()),
        };
        return this.request('GET', 'query', params)
            .then((data: object) => QueryResult.fromJSON(data));
    }

    /**
     * Evaluates an expression query over a range of time
     * @param {*} query Prometheus expression query string.
     * @param {*} start Start Date object or number in milliseconds.
     * @param {*} end End Date object or number in milliseconds.
     * @param {*} step Query resolution step width in number of seconds.
     */
    public rangeQuery(query: string, start: PrometheusQueryDate, end: PrometheusQueryDate, step: number): Promise<QueryResult> {
        const params = {
            query: query,
            start: this.formatTimeToPrometheus(start),
            end: this.formatTimeToPrometheus(end),
            step: step,
        };
        return this.request('GET', 'query_range', params)
            .then((data: object) => QueryResult.fromJSON(data));
    }

    /***********************  METADATA API  ***********************/

    /**
     * Finding series by label matchers
     * @param {*} matchs Repeated series selector argument that selects the series to return.
     * @param {*} start Start Date object or number in milliseconds.
     * @param {*} end End Date object or number in milliseconds.
     */
    public series(matchs: SerieSelector, start: PrometheusQueryDate, end: PrometheusQueryDate): Promise<Metric[]> {
        const params = {
            'match[]': matchs,
            start: this.formatTimeToPrometheus(start),
            end: this.formatTimeToPrometheus(end),
        };
        return this.request<object[]>('GET', 'series', params)
            .then((data: object[]) => data.map(Metric.fromJSON));
    }

    /**
     * Getting label names
     */
    public labelNames(): Promise<any> {
        return this.request('GET', 'labels');
    }

    /**
     * Querying label values
     * @param {*} labelName This argument is not explicit ?
     */
    public labelValues(labelName: string): Promise<any> {
        return this.request('GET', `label/${labelName}/values`);
    }

    /**
     * Overview of the current state of the Prometheus target discovery:
     * @param {*} state Filter by target state. Can be 'active', 'dropped' or 'any'. Optional.
     */
    public targets(state?: TargetState): Promise<object> {
        const params = {
            query: state || 'any',
        };
        return this.request('GET', 'targets', params)
            .then((data: object) => {
                return {
                    'activeTargets': !!data['activeTargets'] ? data['activeTargets'].map(Target.fromJSON) : [],
                    'droppedTargets': !!data['droppedTargets'] ? data['droppedTargets'].map(Target.fromJSON) : [],
                };
            });
    }

    /**
     * Returns metadata about metrics currently scraped from targets.
     * @param {*} matchTarget Label selectors that match targets by their label sets. Optional.
     * @param {*} metric Metric name to retrieve metadata for. Optional.
     * @param {*} limit Maximum number of targets to match. Optional.
     */
    public targetsMetadata(matchTarget: SerieSelector, metric?: string, limit?: number): Promise<any> {
        const params = {
            match_target: matchTarget,
            metric: metric,
            limit: limit,
        };
        return this.request('GET', 'targets/metadata', params);
    }

    /**
     * Metadata about metrics currently scrapped from targets
     * @param {*} metric Metric name to retrieve metadata for. Optional.
     * @param {*} limit Maximum number of targets to match. Optional.
     */
    public metadata(metric?: string, limit?: number): Promise<any> {
        const params = {
            metric: metric,
            limit: limit,
        };
        return this.request('GET', 'metadata', params);
    }

    /***********************  SERIES API  ***********************/

    /**
     * Getting a list of alerting and recording rules
     */
    public rules(): Promise<RuleGroup[]> {
        return this.request('GET', 'rules')
            .then((data: object) => (!!data['groups'] ? data['groups'] : []).map(RuleGroup.fromJSON));
    }

    /**
     * Returns a list of all active alerts.
     */
    public alerts(): Promise<Alert[]> {
        return this.request('GET', 'alerts')
            .then((data: object) => (!!data['alerts'] ? data['alerts'] : []).map(Alert.fromJSON));
    }

    /**
     * Returns an overview of the current state of the Prometheus alertmanager discovery.
     */
    public alertmanagers(): Promise<any> {
        return this.request('GET', 'alertmanagers');
    }

    /***********************  STATUS API  ***********************/

    /**
     * Following status endpoints expose current Prometheus configuration.
     */
    public status(): Promise<any> {
        return this.request('GET', 'status/config');
    }

    /**
     * Returns flag values that Prometheus was configured with.
     * New in v2.2
     */
    public statusFlags(): Promise<any> {
        return this.request('GET', 'status/flags');
    }

    /**
     * Returns runtime information properties that Prometheus was configured with.
     * New in v2.14
     */
    public statusRuntimeInfo(): Promise<any> {
        return this.request('GET', 'status/runtimeinfo');
    }

    /**
     * Returns various build information properties about Prometheus Server.
     */
    public statusBuildinfo(): Promise<any> {
        return this.request('GET', 'status/buildinfo');
    }

    /**
     * Returns various cardinality statistics about the Prometheus TSDB.
     * New in v2.14
     */
    public statusTSDB(): Promise<any> {
        return this.request('GET', 'status/tsdb');
    }


    /***********************  ADMIN API  ***********************/

    /**
     * Creates a snapshot of all current data
     * New in v2.1
     * @param {*} skipHead Skip data present in the head block. Boolean. Optional.
     */
    public adminSnapshot(skipHead?: boolean): Promise<any> {
        const params = {
            skip_head: skipHead,
        };
        return this.request('POST', 'admin/tsdb/snapshot', params);
    }

    /**
     * Deletes data for a selection of series in a time range
     * New in v2.1
     * @param {*} matchs Repeated series selector argument that selects the series to return.
     * @param {*} start Start Date object or number in milliseconds.
     * @param {*} end End Date object or number in milliseconds.
     */
    public adminDeleteSeries(matchs: SerieSelector, start: PrometheusQueryDate, end: PrometheusQueryDate): Promise<any> {
        const params = {
            'match[]': matchs,
            start: this.formatTimeToPrometheus(start),
            end: this.formatTimeToPrometheus(end),
        };
        return this.request('POST', 'admin/tsdb/delete_series', params);
    }

    /**
     * Removes the deleted data from disk and cleans up
     * New in v2.1
     */
    public adminCleanTombstones(): Promise<any> {
        return this.request('POST', 'admin/tsdb/clean_tombstones');
    }

};