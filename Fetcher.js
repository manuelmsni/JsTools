class Fetcher {
    requiresCorsProxy = false;
    initialized = false;
    debugMode = false;

    constructor(debugMode = false) {
        this.debugMode = debugMode;
        this.initialize();
    }

    async initialize() {
        try {
            await this.testCors();
            this.initialized = true;
	    if(this.debugMode) console.log('Fetcher initialized');
        } catch (error) {
	    if(this.debugMode) console.error('Failed to initialize Fetcher:', error);
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
	    if(this.debugMode) console.log('Error al cargar el documento:', error);
        } finally {
            if (!response || !response.ok) {
                this.requiresCorsProxy = true;
	        if(this.debugMode) console.log('Proxy required for CORS requests.');
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
            if(this.debugMode) console.error('Error al cargar el documento:', error);
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
            if(this.debugMode) console.error('Error al cargar el csv:', error);
        }
    }

    async fetchGoogleSheetsCSVAsJson(sheetId, sheetGID = 0) {
        const array2D = await this.fetchGoogleSheetsCSV(sheetId, sheetGID);

        if (!array2D || array2D.length < 2) {
            if(this.debugMode) console.error("CSV no tiene suficientes datos.");
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
            if(this.debugMode) console.error('Error al obtener el texto plano del documento:', error);
        }
    }

async fetchGoogleDocsHtml(docId) {
    const text = await this.fetchGoogleDocsPlainText(docId);
    const lines = text.split('\n');
    const headerPattern = /^#{1,6}\s/;
    const orderedListPattern = /^\d+\./;
    const imagePattern = /^\[image\|([^\]]+)\]$/;
    
    let html = '';
    let isInList = false;
    let listType = null;
    let imageGroup = null;

    lines.forEach(line => {
        const trimmedLine = line.trim();
        if(this.debugMode) console.log("Processing line:", trimmedLine);
        const headerMatch = headerPattern.exec(trimmedLine);
        if (headerMatch) {  // Header
            if (isInList) {
                html += `</${listType}>`;
                isInList = false;
                listType = null;
            }
            const level = headerMatch[0].trim().length;
            html += `<h${level}>${trimmedLine.slice(level).trim()}</h${level}>`;
        }
        else if (trimmedLine.startsWith('*')) { // Unordered list
            if (!isInList || listType !== 'ul') {
                if (isInList) html += `</${listType}>`;
                html += '<ul>';
                isInList = true;
                listType = 'ul';
            }
            html += `<li>${trimmedLine.slice(1).trim()}</li>`;
        }
        else if (orderedListPattern.test(trimmedLine)) { // Ordered list
            if (!isInList || listType !== 'ol') {
                if (isInList) html += `</${listType}>`;
                html += '<ol>';
                isInList = true;
                listType = 'ol';
            }
            html += `<li>${trimmedLine.replace(/^\d+\.\s*/, '').trim()}</li>`;
        }
        else if (imagePattern.test(trimmedLine)) { // Image processing
            const imageMatch = imagePattern.exec(trimmedLine);
            if (imageMatch) {
                const imageContent = imageMatch[1].trim();
                let attributes = {};
                let imageHtml = '';
                let imageSrc = '';
                
                const srcPattern = /src:([^\|]+)/;
                const srcMatch = srcPattern.exec(imageContent);
                if (srcMatch) {
                    imageSrc = srcMatch[1].trim();
                    attributes.src = imageSrc;
                }

		const attributesString = imageContent.split("|")[1];
                const attributesPattern = /(\w+)(?:="([^"]*)")?/g;
                let match;
	        while ((match = attributesPattern.exec(attributesString)) !== null) {
		    let key = match[1].trim();
		    if (key) {
		        let value = match[2] || true;
		        attributes[key] = value;
		    }
		}
		    
		if(this.debugMode) console.log(attributes);
		    
                imageHtml += `<img src="${imageSrc}" alt="${attributes.alt || 'Embedded Image'}"`;

                for (const key in attributes) {
                    if (!["alt", "src", "group", "figure", "caption"].includes(key)) {
                        imageHtml += ` ${key}="${attributes[key]}"`;
                    }
                }

                imageHtml += ' />';

                if (attributes.group) {
                    if (imageGroup !== attributes.group) {
                        if (imageGroup) {
                            html += `</div>`;
                        }
                        html += `<div class="image-group">`;
                        imageGroup = attributes.group;
                    }
                }

	        if (attributes.figure) {
                    html += '<figure>';
                }
                
                html += imageHtml;

                if (attributes.figure) {
		    if(attributes.caption){
		        html += `<figcaption>${attributes.caption}</figcaption>`
		    }
                    html += '</figure>';
                }
            }
        }
        else { // Plain text
            if (isInList) {
                html += `</${listType}>`;
                isInList = false;
                listType = null;
            }
	    if (imageGroup) {
                html += `</div>`;
		imageGroup = null;
	    }
            if (trimmedLine) {
                html += `<p>${trimmedLine}</p>`;
            }
        }
    });
    
    // Close any open list or group
    if (isInList) {
        html += `</${listType}>`;
    }
    if (imageGroup) {
        html += `</div>`;
    }
    
    return html;
}

}
