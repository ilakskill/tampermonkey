// ==UserScript==
// @name         WorkMarket Assignment Details Scraper
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  Scrapes assignment IDs from the list page and fetches details for each.
// @author       ilakskill
// @match        https://www.workmarket.com/assignments*
// @connect      www.workmarket.com
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
//
// ==Changelog==
// @version 1.4
// - Completely rewrote `parseDetailsPage` function.
// - Now parses embedded 'workEncoded' JSON object for reliable data
//   (description, pay, schedule).
// - Added helper functions to decode and clean HTML.
// - Added new fields to output: company, start_date, pay_type, pay_rate,
//   max_hours, max_spend, required_tools.
// - Improved CSS selectors for title and location.
//
// @version 1.3
// - Added console.log for each individual assignment's parsed data.
//
// @version 1.2
// - Added detailed console.log statements for debugging.
//
// @version 1.1
// - Updated @match rule to `https://www.workmarket.com/assignments*`.
//
// @version 1.0
// - Initial release.
//
// ==/UserScript==

(function() {
    'use strict';

    console.log('WorkMarket Scraper userscript v1.4 loaded.');

    // --- 1. Add a button to the page to trigger the scrape ---
    const controlButton = document.createElement('button');
    controlButton.textContent = 'Fetch Assignment Details';
    controlButton.setAttribute('id', 'fetchDetailsButton');
    document.body.appendChild(controlButton);
    console.log('Scraper button added to page.');

    // --- 2. Style the button so it's visible ---
    GM_addStyle(`
        #fetchDetailsButton {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 9999;
            padding: 12px 18px;
            background-color: #007bff;
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            transition: background-color 0.3s ease;
        }
        #fetchDetailsButton:hover {
            background-color: #0056b3;
        }
        #fetchDetailsButton:active {
            background-color: #004085;
            transform: translateY(1px);
        }
        #fetchDetailsButton:disabled {
            background-color: #aaa;
            cursor: not-allowed;
        }
    `);

    // --- 3. Add click event listener to the button ---
    controlButton.addEventListener('click', fetchAllDetails);

    /**
     * Main function to control the scraping process.
     */
    async function fetchAllDetails() {
        controlButton.textContent = 'Fetching...';
        controlButton.disabled = true;

        console.log('Starting to fetch assignment details...');
        const assignmentIds = getAssignmentIds();
        console.log(`Found ${assignmentIds.length} unique assignment IDs:`, assignmentIds);

        if (assignmentIds.length === 0) {
            // Use a custom modal instead of alert
            showModal('No assignment IDs found on this page.');
            controlButton.textContent = 'Fetch Assignment Details';
            controlButton.disabled = false;
            return;
        }

        const allDetails = [];
        let successCount = 0;
        let failCount = 0;

        for (const id of assignmentIds) {
            try {
                const detailsHtml = await fetchAssignmentDetails(id);
                // The parseDetailsPage function extracts info from the fetched HTML
                const detailsJson = parseDetailsPage(detailsHtml, id);

                // --- ### NEW LOGGING ### ---
                // This will log the parsed data for each item as it completes
                console.log(`--- Parsed Data for ID: ${id} ---`);
                console.log(detailsJson);
                // --- ### END NEW LOGGING ### ---

                allDetails.push(detailsJson);
                successCount++;
                console.log(`Successfully parsed details for ID: ${id}`);
            } catch (error) {
                console.error(`Failed to fetch/parse details for ID: ${id}`, error);
                allDetails.push({ id: id, error: error.message, status: 'Failed' });
                failCount++;
            }
        }

        console.log('--- All Assignment Details ---');
        // Log the result as a JSON string for easy copy-pasting
        console.log(JSON.stringify(allDetails, null, 2));

        const message = `Finished!
        - Succeeded: ${successCount}
        - Failed: ${failCount}

        Check the console (F12) for the full JSON output.`;
        
        showModal(message);

        controlButton.textContent = 'Fetch Assignment Details';
        controlButton.disabled = false;
    }

    /**
     * Scans the document to find all assignment IDs.
     * @returns {string[]} An array of unique assignment IDs.
     */
    function getAssignmentIds() {
        console.log('Scanning page for assignment IDs...');
        const ids = new Set();
        // Regex to find "Assign. ID:" followed by numbers
        const idRegex = /Assign\. ID:\s*(\d+)/;

        // Use XPath to find all text nodes that contain the target text.
        // This is more reliable than querySelector.
        const textNodes = document.evaluate(
            "//text()[contains(., 'Assign. ID:')]",
            document,
            null,
            XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
            null
        );

        console.log(`Found ${textNodes.snapshotLength} text nodes with "Assign. ID:".`);

        for (let i = 0; i < textNodes.snapshotLength; i++) {
            const node = textNodes.snapshotItem(i);
            const match = node.textContent.match(idRegex);
            // If a match is found, add the ID (group 1) to the Set
            if (match && match[1]) {
                ids.add(match[1]);
            }
        }

        return Array.from(ids);
    }

    /**
     * Fetches the HTML content of a single assignment details page.
     * @param {string} id - The assignment ID.
     * @returns {Promise<string>} A promise that resolves with the HTML text.
     */
    function fetchAssignmentDetails(id) {
        const url = `https://www.workmarket.com/assignments/details/${id}`;
        console.log(`Fetching details from: ${url}`);
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300) {
                        console.log(`Successfully fetched details for ID: ${id}`);
                        resolve(response.responseText);
                    } else {
                        console.error(`HTTP Error for ID ${id}: ${response.status} ${response.statusText}`);
                        reject(new Error(`HTTP Error: ${response.status} ${response.statusText}`));
                    }
                },
                onerror: function(error) {
                    console.error(`Network Error for ID ${id}:`, error);
                    reject(new Error(`Network Error: ${error.statusText || 'Unknown error'}`));
                }
            });
        });
    }

    /**
     * Parses the HTML string of the details page to extract key information.
     *
     * @param {string} htmlString - The full HTML of the details page.
     * @param {string} id - The assignment ID.
     * @returns {object} A structured object with the extracted data.
     */
    function parseDetailsPage(htmlString, id) {
        console.log(`--- Parsing details for ID: ${id} ---`);
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, 'text/html');

        // Helper function to safely get text content
        const getText = (selector) => {
            const element = doc.querySelector(selector);
            const text = element ? element.textContent.trim() : 'Not found';
            console.log(`Selector: "${selector}", Found text: "${text}"`);
            return text;
        };
        
        // Helper function to decode HTML entities (e.g., &lt;p&gt;)
        function decodeHtmlEntities(text) {
            var textArea = document.createElement('textarea');
            textArea.innerHTML = text;
            return textArea.value;
        }

        // Helper function to strip HTML tags from a string
        function cleanHtml(html) {
            // Create a new div element
            const tempDiv = document.createElement('div');
            // Set its innerHTML to the HTML string
            tempDiv.innerHTML = html;
            
            // Use querySelectorAll to find all <li> elements
            const listItems = tempDiv.querySelectorAll('li');
            if (listItems.length > 0) {
                let text = '';
                // Prepend each <li> text with a bullet or dash
                listItems.forEach(li => {
                    text += `- ${li.textContent.trim()}\n`;
                });
                // Find parent container to replace ul/ol
                const listParent = listItems[0].parentNode.parentNode;
                // Create a text node with the formatted list
                const textNode = document.createTextNode(text);
                // Replace the ul/ol with the new text node
                if(listParent) {
                    listParent.parentNode.replaceChild(textNode, listParent);
                }
            }
            
            // Replace <p> and <br> with newlines for readability
            tempDiv.querySelectorAll('p').forEach(p => p.insertAdjacentText('afterend', '\n'));
            tempDiv.querySelectorAll('br').forEach(br => br.insertAdjacentText('afterend', '\n'));
            
            // Return the textContent, which now includes newlines
            let content = tempDiv.textContent || "";
            // Clean up extra whitespace
            return content.replace(/\n\s*\n/g, '\n').trim();
        }


        // --- ### NEW PARSING LOGIC ### ---
        
        // 1. Get Title
        let title = 'Not found';
        const titleEl = doc.querySelector('h2.assignment-header');
        if (titleEl) {
            const clone = titleEl.cloneNode(true);
            const smallEl = clone.querySelector('small');
            if (smallEl) smallEl.remove(); // Remove the (ID: ...) part
            title = clone.textContent.trim();
        }
        console.log(`Selector: "h2.assignment-header", Found text: "${title}"`);

        // 2. Get Location
        let location = 'Not found';
        // This selector finds the third <dl> in the sidebar, which is the location
        const locEl = doc.querySelector('.sidebar .intro-summary dl.iconed-dl:nth-of-type(3) dd');
        if (locEl) {
            location = locEl.textContent.trim().split('\n')[0]; // Get first line, remove (xx.x mi)
        }
        console.log(`Selector: ".sidebar .intro-summary dl.iconed-dl:nth-of-type(3) dd", Found text: "${location}"`);

        // 3. Get Company
        // This selector finds the fourth <dl> in the sidebar, which is the company
        const company = getText('.sidebar .intro-summary dl.iconed-dl:nth-of-type(4) dd strong a');

        // 4. Get data from embedded JSON
        let description = 'Not found';
        let pay_type = 'Not found';
        let pay_rate = 0;
        let max_hours = 0;
        let max_spend = 0;
        let start_date = 'Not found';
        let required_tools = 'Not found';
        
        try {
            // This regex finds the 'workEncoded' object in the page's script
            const workEncodedMatch = htmlString.match(/workEncoded:\s*({[\s\S]*?}),\s*authEncoded:/);
            if (workEncodedMatch && workEncodedMatch[1]) {
                const workData = JSON.parse(workEncodedMatch[1]);
                console.log('Successfully parsed workEncoded JSON object.');
                
                if (workData.description) {
                    const decodedHtml = decodeHtmlEntities(workData.description);
                    const cleanText = cleanHtml(decodedHtml);
                    
                    // Try to split scope and tools
                    const toolsRegex = /Required Tools:/i;
                    if (toolsRegex.test(cleanText)) {
                        const parts = cleanText.split(toolsRegex);
                        description = parts[0].replace('Scope of Work:', '').trim();
                        required_tools = parts[1].trim();
                    } else {
                        description = cleanText.replace('Scope of Work:', '').trim();
                    }
                }

                if (workData.pricing) {
                    pay_type = workData.pricing.type;
                    pay_rate = workData.pricing.perHourPrice;
                    max_hours = workData.pricing.maxNumberOfHours;
                    max_spend = workData.pricing.maxSpendLimit;
                }
                
                if (workData.schedule && workData.schedule.from) {
                    start_date = new Date(workData.schedule.from).toLocaleString();
                }
                
            } else {
                console.log('Could not find workEncoded JSON object. Falling back to old selectors.');
                description = cleanHtml(decodeHtmlEntities(getText('#desc-text'))); // Fallback
            }
        } catch (e) {
            console.error('Error parsing workEncoded JSON:', e);
            description = cleanHtml(decodeHtmlEntities(getText('#desc-text'))); // Fallback
        }
        
        // --- ### END OF NEW LOGIC ### ---

        console.log(`--- Finished parsing for ID: ${id} ---`);

        // Return a structured object
        return {
            id: id,
            url: `https://www.workmarket.com/assignments/details/${id}`,
            status: 'Succeeded',
            title: title,
            company: company,
            location: location,
            start_date: start_date,
            pay_type: pay_type,
            pay_rate: pay_rate,
            max_hours: max_hours,
            max_spend: max_spend,
            description: description,
            required_tools: required_tools,
        };
    }

    /**
     * Shows a simple modal message instead of using alert().
     * @param {string} message - The text to display.
     */
    function showModal(message) {
        // Check if a modal already exists
        let modal = document.getElementById('wm-scraper-modal');
        if (!modal) {
            // Create modal elements
            modal = document.createElement('div');
            modal.setAttribute('id', 'wm-scraper-modal');
            
            const modalContent = document.createElement('div');
            const modalText = document.createElement('pre');
            const closeButton = document.createElement('button');

            // Style modal
            GM_addStyle(`
                #wm-scraper-modal {
                    position: fixed;
                    z-index: 10001;
                    left: 0;
                    top: 0;
                    width: 100%;
                    height: 100%;
                    overflow: auto;
                    background-color: rgba(0,0,0,0.5);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                #wm-scraper-modal-content {
                    background-color: #fefefe;
                    margin: auto;
                    padding: 20px;
                    border: 1px solid #888;
                    border-radius: 8px;
                    width: 80%;
                    max-width: 500px;
                    box-shadow: 0 5px 15px rgba(0,0,0,0.3);
                    position: relative;
                }
                #wm-scraper-modal-text {
                    font-family: monospace;
                    white-space: pre-wrap;
                    word-wrap: break-word;
                    font-size: 14px;
                    max-height: 300px;
                    overflow-y: auto;
                }
                #wm-scraper-modal-close {
                    color: #aaa;
                    position: absolute;
                    top: 10px;
                    right: 15px;
                    font-size: 28px;
                    font-weight: bold;
                    border: none;
                    background: none;
                    cursor: pointer;
                }
                #wm-scraper-modal-close:hover,
                #wm-scraper-modal-close:focus {
                    color: black;
                    text-decoration: none;
                }
            `);
            
            // Assemble modal
            closeButton.setAttribute('id', 'wm-scraper-modal-close');
            closeButton.innerHTML = '&times;';
            modalText.setAttribute('id', 'wm-scraper-modal-text');
            
            modalContent.setAttribute('id', 'wm-scraper-modal-content');
            modalContent.appendChild(closeButton);
            modalContent.appendChild(modalText);
            modal.appendChild(modalContent);
            document.body.appendChild(modal);

            // Add close behavior
            closeButton.onclick = () => modal.style.display = 'none';
            modal.onclick = (event) => {
                if (event.target == modal) {
                    modal.style.display = 'none';
                }
            };
        }

        // Set message and display
        document.getElementById('wm-scraper-modal-text').textContent = message;
        modal.style.display = 'flex';
    }

})();
