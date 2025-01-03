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
    const text = await this.fetchGoogleDocsPlainText(docId);
    const lines = text.split('\n');
    let html = '';
    let isInList = false;
    let listType = null;
    let imageGroup = null;

    lines.forEach(line => {
        const trimmedLine = line.trim();

        // Debugging: Mostrar el contenido de cada línea procesada
        console.log("Processing line:", trimmedLine);

        // Check for header
        const headerMatch = /^#{1,6}\s/.exec(trimmedLine);
        if (headerMatch) {
            if (isInList) {
                html += `</${listType}>`;
                isInList = false;
                listType = null;
            }
            const level = headerMatch[0].trim().length;
            html += `<h${level}>${trimmedLine.slice(level).trim()}</h${level}>`;
        }

        // Check for unordered list
        else if (trimmedLine.startsWith('*')) {
            if (!isInList || listType !== 'ul') {
                if (isInList) html += `</${listType}>`;
                html += '<ul>';
                isInList = true;
                listType = 'ul';
            }
            html += `<li>${trimmedLine.slice(1).trim()}</li>`;
        }

        // Check for ordered list
        else if (/^\d+\./.test(trimmedLine)) {
            if (!isInList || listType !== 'ol') {
                if (isInList) html += `</${listType}>`;
                html += '<ol>';
                isInList = true;
                listType = 'ol';
            }
            html += `<li>${trimmedLine.replace(/^\d+\.\s*/, '').trim()}</li>`;
        }

        // Check for image with pattern [image*]
        const imagePattern = /^\[image([^\]]*)\]$/;
        if (imagePattern.test(trimmedLine)) {
            console.log("Image match found:", trimmedLine);

            const imageMatch = imagePattern.exec(trimmedLine);
            if (imageMatch) {
                const imageSrc = imageMatch[1].trim(); // src URL

                // If the src is not empty or invalid, create the image
                if (imageSrc) {
                    let attributes = {};
                    const attributesPattern = /\|([^:]+):([^|]+)\|/g;
                    let match;

                    // Extract attributes if they exist
                    while ((match = attributesPattern.exec(trimmedLine)) !== null) {
                        attributes[match[1].trim()] = match[2].trim();
                    }

                    // Create image HTML based on src and attributes
                    let imageHtml = `<img src="${imageSrc}" alt="${attributes.alt || 'Embedded Image'}"`;

                    // Apply attributes if found
                    for (const key in attributes) {
                        if (key !== 'alt') {
                            imageHtml += ` ${key}="${attributes[key]}"`;
                        }
                    }

                    imageHtml += ' />';

                    // Check for group attribute
                    if (attributes.group) {
                        if (imageGroup !== attributes.group) {
                            if (imageGroup) {
                                html += `</div>`; // Close previous group if exists
                            }
                            html += `<div class="image-group">`; // Start a new group
                            imageGroup = attributes.group;
                        }
                    }

                    // Append the generated image HTML
                    html += imageHtml;
                }
            }
        }

        // Check for paragraph or plain text
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

    // Close any open list or group
    if (isInList) {
        html += `</${listType}>`;
    }
    if (imageGroup) {
        html += `</div>`; // Close last image group if any
    }

    return html;
}
}
