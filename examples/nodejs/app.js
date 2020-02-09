const PrometheusQuery = require('../../');

const pq = new PrometheusQuery({
    endpoint: "http://demo.robustperception.io:9090/",
});

const query1 = 'up{instance="demo.robustperception.io:9100",job="node"}';
const query2 = 'up{}';

// last `up` value
pq.instantQuery(query1)
    .then((res) => {
        console.log("****************", "[instantQuery] Query:", query1, "****************")
        console.log("\n");

        const series = res.data.result;
        series.forEach((serie) => {
            console.log("[instantQuery] Serie:", PrometheusQuery.metricToReadable(serie.metric));
            console.log("[instantQuery] Time:", new Date(serie.value[0] * 1000));
            console.log("[instantQuery] Value:", serie.value[1]);
            console.log("\n");
        });
    })
    .catch(console.error);

// up during past 24h, 1 point every 6 hours
pq.rangeQuery(query2, new Date().getTime() - 24 * 60 * 60 * 1000, new Date(), 6 * 60 * 60)
    .then((res) => {
        console.log("****************", "[rangeQuery] Query:", query2, "****************");
        console.log("\n");

        const series = res.data.result;
        series.forEach((serie) => {
            const series = res.data.result;
            series.forEach((serie) => {
                console.log("[rangeQuery] Serie:", PrometheusQuery.metricToReadable(serie.metric));
                console.log("[rangeQuery] Values:", JSON.stringify(serie.values));
                console.log("\n");
            });
        });
    })
    .catch(console.error);