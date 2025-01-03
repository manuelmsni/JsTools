class Fetcher {
    requiresCorsProxy = false;
    initialized = false;

    constructor() {
        this.initialize();
    }

    async initialize() {
        try {
            await this.testCors();
            this.initialized = true;
            console.log('Fetcher initialized');
        } catch (error) {
            console.error('Failed to initialize Fetcher:', error);
        }
    }

    async waitForInitialization() {
        while (!this.initialized) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }

    async testCors() {
        var response;
        try {
            response = await fetch('https://httpbin.org/cors');
        } catch (error) {
            console.log('Error al cargar el documento:', error);
        } finally {
            if (!response || !response.ok) {
                this.requiresCorsProxy = true;
                console.log('Proxy required for CORS requests.');
            }
        }
    }

    async fetchFileContent(url) {
        await this.waitForInitialization();
        const response = await fetch(url);
        const data = await response.text();
        return data;
    }

    async fetchFileContentAvoidingCors(url) {
        await this.waitForInitialization();
        var data;
        try {
            if (!this.requiresCorsProxy) {
                data = await this.fetchFileContent(url);
            } else {
                data = await this.fetchFileContent('https://corsproxy.io/?' + url);
            }
        } catch (error) {
            console.error('Error al cargar el documento:', error);
        } finally {
            return data;
        }
    }

    async fetchGoogleSheetsCSV(sheetId, sheetGID) {
        await this.waitForInitialization();
        var targetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${sheetGID}`;
        var csv;
        try {
            csv = await this.fetchFileContentAvoidingCors(targetUrl);
            const rows = csv.split('\n').map(row => row.trim());
            const array2D = rows.map(row => row.split(',').map(col => col.trim().replace("\r", "")));
            return array2D;
        } catch (error) {
            console.error('Error al cargar el csv:', error);
        }
    }

    async fetchGoogleSheetsCSVAsJson(sheetId, sheetGID) {
        const array2D = await this.fetchGoogleSheetsCSV(sheetId, sheetGID);

        if (!array2D || array2D.length < 2) {
            console.error("CSV no tiene suficientes datos.");
            return [];
        }

        const [headers, ...rows] = array2D;
        const jsonArray = rows.map(row => {
            let obj = {};
            headers.forEach((header, index) => {
                obj[header] = row[index];
            });
            return obj;
        });

        return jsonArray;
    }

    async fetchDataWithCache(key, fetchFunction, expTimeInMs = 86400000) {
	const cachedData = localStorage.getItem(key);
	const cachedExpiry = localStorage.getItem('cacheExpiry');
	const now = new Date().getTime();
	let expiryData = cachedExpiry ? JSON.parse(cachedExpiry) : {};
	if (cachedData && expiryData[key] && now < expiryData[key]) {
	    return JSON.parse(cachedData);
	}
	const data = await fetchFunction();
	localStorage.setItem(key, JSON.stringify(data));
	expiryData[key] = now + expTimeInMs;
	localStorage.setItem('cacheExpiry', JSON.stringify(expiryData));
	return data;
    }

    getImageUrlFromDrive(id){
        return 'https://drive.google.com/uc?export=download&id=' + id;
    }

    async fetchGoogleDocsPlainText(docId) {
        await this.waitForInitialization();
        const targetUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
        try {
            const plainText = await this.fetchFileContentAvoidingCors(targetUrl);
            return plainText;
        } catch (error) {
            console.error('Error al obtener el texto plano del documento:', error);
        }
    }

    async fetchGoogleDocsHtml(docId) {
	const text = await fetchGoogleDocsPlainText(docId);
        const lines = text.split('\n');
        let html = '';
        let isInList = false;
        let listType = null;

        lines.forEach(line => {
	    const trimmedLine = line.trim();

	    if (trimmedLine.startsWith('*')) {
	        if (!isInList || listType !== 'ul') {
		    if (isInList) html += `</${listType}>`;
		    html += '<ul>';
		    isInList = true;
		    listType = 'ul';
	        }
	        html += `<li>${trimmedLine.slice(1).trim()}</li>`;
	    }

	    else if (/^\d+\./.test(trimmedLine)) {
	        if (!isInList || listType !== 'ol') {
		    if (isInList) html += `</${listType}>`;
		    html += '<ol>';
		    isInList = true;
		    listType = 'ol';
	        }
	        html += `<li>${trimmedLine.replace(/^\d+\.\s*/, '').trim()}</li>`;
	    }

	    else {
	        if (isInList) {
		    html += `</${listType}>`;
		    isInList = false;
		    listType = null;
	        }
	        if (trimmedLine) {
		    html += `<p>${trimmedLine}</p>`;
	        }
	    }
        });

        if (isInList) {
	    html += `</${listType}>`;
        }
	    
        return html;
    }
}
