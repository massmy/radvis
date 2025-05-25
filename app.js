let parsedData;
let currentData;
let deferredPrompt;
const installBtn = document.getElementById('installBtn');

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.style.display = 'inline-block';

    installBtn.addEventListener('click', async () => {
    installBtn.style.display = 'none';
    deferredPrompt.prompt();

    const {outcome} = await deferredPrompt.userChoice;
    console.log('User choice:', outcome);
    deferredPrompt = null;
    });
});

function parseTime(data) {
    if (typeof data?.Time?.getMonth == 'function') return data.Time;
    const [hh, mm, ss] = (data.Time || data)?.split(":").map(Number);
    const date = new Date();
    date.setHours(hh, mm, ss, 0);
    return date;
}

function parseTimeStrings(data) {
    return data.map((d) => {
        return parseTime(d).toISOString();
    });
}

function downsample(data, step = 10) {
    return data.filter((_, index) => index % step === 0);
}

function processData(mode, data, field = "CPS") {
    switch (mode) {
    // case "smart":
    //   return downsampleLTTB(data, 1000);
    case "downsample":
        return downsample(data, 20)
    case "smooth":
        return movingAverage(movingAverage(movingAverage(data, field, 10), "Alt", 10), "uSv/h", 10);
    case "bucketMax":
        return aggregateByTimeWindowMax(data);
    default:
        return data;
    }
}

function movingAverage(data, field, windowSize = 5) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - windowSize + 1);
    const slice = data.slice(start, i + 1);
    const avg = slice.reduce((sum, d) => sum + parseFloat(d[field]), 0) / slice.length;
    result.push({
        ...data[i],
        [field]: avg.toString()
    });
    }
    return result;
}

function setRange(rangeKey) {
    const now = new Date(parseTime(currentData[currentData.length - 1])); // letzter Zeitwert
    let from;
    const charts = ["cps-line", "usvh-line", "altitude-line"];
    switch (rangeKey) {
    case "10m":
        from = new Date(now.getTime() - 10 * 60 * 1000);
        break;
    case "30m":
        from = new Date(now.getTime() - 30 * 60 * 1000);
        break;
    case "2h":
        from = new Date(now.getTime() - 2 * 60 * 60 * 1000);
        break;
    case "1d":
        from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
    case "all":
        charts.map((v) => Plotly.relayout(v, {"xaxis.autorange": true}))
        return;
    }
    charts.map((v) => Plotly.relayout(v, {
    "xaxis.range": [from.toISOString(), now.toISOString()]
    }));
}


function aggregateByTimeWindowMax(data, windowMs = 10000) {
    if (data.length === 0) return [];

    const result = [];
    let bucket = [];
    let bucketStart = data[0].ParsedTime.getTime();

    for (const d of data) {
        const t = d.ParsedTime.getTime();
        if (t < bucketStart + windowMs) {
            bucket.push(d);
        } else {
            result.push(maxBucket(bucket, bucketStart));
            bucket = [d];
            bucketStart = t;
        }
    }

    if (bucket.length > 0) {
    result.push(maxBucket(bucket, bucketStart));
    }

    return result;
}

function maxBucket(bucket, startTime) {
    const max = (arr, key) =>
    Math.max(...arr.map(d => parseFloat(d[key])));

    return {
    Time: new Date(startTime + 5000), // Mitte des Buckets
    CPS: max(bucket, "CPS"),
    "uSv/h": max(bucket, "uSv/h"),
    "Alt": max(bucket, "Alt")
    };
}

function plotLineChart(data, field, title, elementId) {
    const times = parseTimeStrings(data);
    const values = data.map((d) => parseFloat(d[field]));

    const trace = {
    x: times,
    y: values,
    // mode: "lines+markers",
    mode: 'lines',
    type: "scattergl",
    line: {color: "#3399ff"},
    fill: "tozeroy",
    fillcolor: "rgba(51, 153, 255, 0.2)",
    line: {
        color: "rgba(51, 153, 255, 1)",
        width: 2
    },
    marker: {size: 4},
    name: field,
    };
    const lastTime = new Date(parseTime(data[data.length - 1]));
    const tenMinAgo = new Date(lastTime.getTime() - 30 * 60 * 1000);
    const isMobile = window.innerWidth < window.innerHeight;
    const fontSize = isMobile ? 9 : 14;
    const layout = {
    title,
    xaxis: {
        title: {text: "time", font: {size: fontSize}},
        type: "date",
        tickformat: "%H:%M:%S",
        rangeslider: {visible: false},
        range: [tenMinAgo.toISOString(), lastTime.toISOString()],
        showgrid: false,
    },
    yaxis: {
        title: {text: field, font: {size: fontSize}},
        showgrid: true,
        gridcolor: "#eee"
    },
    // margin: { t: 40, r: 10, b: 40, l: 50 },
    margin: {t: 30, b: 40, l: 45, r: 10},
    plot_bgcolor: "#fff",
    paper_bgcolor: "#fff",
    hovermode: "closest",
    autosize: true,
    font: {
        family: "system-ui, sans-serif",
        size: fontSize,
        color: "#222"
    }
    };
    const config = {
    responsive: true,
    scrollZoom: false, // kein 1-Finger-Zoom
    displayModeBar: true,
    displaylogo: false,
    doubleClick: "reset",
    staticPlot: false,
    modeBarButtonsToRemove: [
        // "zoom",
        // "pan",
        "select",
        "sendDataToCloud",
        "autoScale2d",
        "select2d",
        "lasso2d",
        "hoverCompareCartesian"
    ],
    // Touch-Fix:
    dragmode: false
    };

    Plotly.newPlot(elementId, [trace], layout, config);
}
function parseCSVText(text) {
    const rows = text.trim().split("\n").map(row => row.split(","));
    const rawHeader = rows.shift();
    const header = rawHeader.map(h => h.replace(/^"|"$/g, "").trim());

    return rows.map(row => {
    let obj = {};
    row.forEach((val, i) => {
        obj[header[i]] = val.replace(/^"|"$/g, "").trim();
    });
    if (obj !== undefined && obj["Time"]) {
        obj["ParsedTime"] = parseTime(obj["Time"]);
    }
    return obj;
    }).filter(d => d["Time"]);
}

function setToggleButton(container, id, name, getValue, setValue, callback) {
    const btn = document.createElement("button");
    btn.id = id;
    container.append(btn);
    let setText = (currentValue) => btn.textContent = `🔁 ${name}: ${currentValue ? "ON" : "Off"}`;
    setText(getValue())
    btn.addEventListener("click", () => {
        const newValue = !getValue();
        setValue(newValue)
        setText(newValue);
        callback();
    });
}

function setButton(container, id, name, callback) {
    const btn = document.createElement("button");
    btn.id = id;
    btn.textContent = name;
    container.append(btn);
    btn.addEventListener("click", callback);
}
const config = {
    isDownsampled: false,
    isSmoothed: false,
    isBucketMax: true,
    rangeKey: "30m"
}
function getDataWithFilters() {
    let data = filterRangeAggregatedMax(config.rangeKey, parsedData);
    if (config.isBucketMax) {
        data = processData("bucketMax", data);
    }
    if (config.isSmoothed) {
        data = processData("smooth", data);
    }
    if (config.isDownsampled) {
        data = processData("downsample", data);
    }
    currentData = data;
    return data;
}

const updateFilterAndPlots = () => updatePlots(getDataWithFilters());

async function main() {
    const buttons = document.getElementById('controls');
    setToggleButton(buttons, "toggleDownsample", "Downsampling", () => config.isDownsampled, (value) => config.isDownsampled = value, updateFilterAndPlots);
    setToggleButton(buttons, "toggleSmoothing", "Smoothing", () => config.isSmoothed, (value) => config.isSmoothed = value, updateFilterAndPlots);
    setToggleButton(buttons, "toggleBucketMax", "BucketMax Algo", () => config.isBucketMax, (value) => config.isBucketMax = value, updateFilterAndPlots);

    async function load(text){
        try {
            parsedData = parseCSVText(text);
            const sampledData = parsedData;
            updateFilterAndPlots();
        } catch (err) {
            console.error(err);
            alert(err);
        }
    }
    setButton(buttons, "testData", "load testData", async () => {
      const response = await fetch("./2025-01-01_stripped.csv");
      const text = await response.text();
      await load (text);
    });

    document.getElementById("fileInput").addEventListener("change", async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        load(await file.text())
    });
}
function filterRangeAggregatedMax(rangeKey, data) {
  const lastTime = new Date(parseTime(data[data.length - 1])); 
  let from;
  switch (rangeKey) {
    case "10m": from = new Date(lastTime - 10 * 60 * 1000); break;
    case "30m": from = new Date(lastTime - 30 * 60 * 1000); break;
    case "2h":  from = new Date(lastTime - 2 * 60 * 60 * 1000); break;
    case "1d":  from = new Date(lastTime - 24 * 60 * 60 * 1000); break;
    case "all": return data;
  }

  const filtered = data.filter(d => { const time = parseTime(d); return time >= from && time <= lastTime });
  return filtered;
}

function setRangeAggregatedMax(rangeKey) {
    config.rangeKey = rangeKey;
    updateFilterAndPlots();
}

function updatePlots(sampledData) {
    plotLineChart(sampledData, "CPS", "Count Rate (CPS)", "cps-line");
    plotLineChart(sampledData, "uSv/h", "Dose rate (µSv/h)", "usvh-line");
    plotLineChart(sampledData, "Alt", "Altitude", "altitude-line");
    linkPlots("cps-line", "usvh-line", "altitude-line");
}
function linkPlots(plot1, plot2, plot3) {
    let block = false;

    function syncAxis(source, target) {
    source.on('plotly_relayout', (eventData) => {
        if (block) return;
        block = true;

        const xRange = {
        'xaxis.range[0]': eventData['xaxis.range[0]'],
        'xaxis.range[1]': eventData['xaxis.range[1]'],
        };

        Plotly.relayout(target, xRange).then(() => (block = false));
    });
    }

    const p1 = document.getElementById(plot1);
    const p2 = document.getElementById(plot2);
    const p3 = document.getElementById(plot3);

    syncAxis(p1, p2);
    syncAxis(p2, p1);
    syncAxis(p3, p1);
    syncAxis(p1, p3);
    syncAxis(p2, p3);
    syncAxis(p3, p3);
}

main();