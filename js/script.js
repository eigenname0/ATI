// initInvoiceForm is called once from home.html, after Firebase confirms who
// is signed in and their profile has loaded (see requireAuth in auth.js).
const INVOICE_TYPES = {
	sales: { label: "Sales Tax Invoice", prefix: "STI", party: "Customer", bill: "BILL TO", arabic: "فاتورة ضريبية" },
	purchase_tax: { label: "Purchase Tax Invoice", prefix: "PI", party: "Customer", bill: "BILL TO", arabic: "فاتورة مشتريات" },
	purchase_non_vat: { label: "Purchase Non-Tax Invoice", prefix: "PU", party: "Customer", bill: "BILL TO", arabic: "فاتورة مشتريات بدون ضريبة" },
	commercial: { label: "Commercial Invoice", prefix: "CI", party: "Customer", bill: "BILL TO", arabic: "فاتورة تجارية" },
	consignment: { label: "Consignment Invoice", prefix: "CSI", party: "Customer", bill: "BILL TO", arabic: "فاتورة أمانة" },
	proforma: { label: "Pro Forma Invoice", prefix: "PFI", party: "Customer", bill: "BILL TO", arabic: "فاتورة أولية" },
	credit: { label: "Credit Note", prefix: "CN", party: "Customer", bill: "CREDIT TO", arabic: "إشعار دائن" }
};

let nextInvoiceSequences = {};
let invoiceSequencesReady = false;
let invoiceNumberManuallyEdited = false;
let savedInvoiceContacts = [];
let savedItemBrandModels = [];
let savedItemReferenceNumbers = [];
let savedItemSerialNumbers = [];
let currentSavedInvoiceId = null;
let currentSavedInvoiceSequence = null;
let localInvoiceSyncOnlineHandler = null;

function normalizeContactName(name) {
	return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeSavedItemValue(value) {
	return String(value || "").trim().replace(/\s+/g, " ");
}

function addUniqueSavedItemValue(list, value) {
	const normalized = normalizeSavedItemValue(value);
	if (!normalized) return;
	if (list.some(item => item.toLowerCase() === normalized.toLowerCase())) return;
	list.push(normalized);
}

function getItemDescriptionText(row) {
	const descField = row.querySelector(".desc");
	if (descField && descField.value.trim()) return descField.value.trim();
	return [
		row.querySelector(".itemBrand")?.value.trim(),
		row.querySelector(".itemRef")?.value.trim(),
		row.querySelector(".itemSerial")?.value.trim()
	].filter(Boolean).join(" • ");
}

function normalizeInvoiceType(invoiceType) {
	const type = invoiceType === "purchase" ? "purchase_tax" : (invoiceType || "sales");
	return INVOICE_TYPES[type] ? type : "sales";
}

function refreshSavedContactOptions() {
	const picker = document.getElementById("savedContactPicker");
	if (!picker) return;
	const hasContacts = savedInvoiceContacts.length > 0;
	picker.querySelector(".savedContactToggle").hidden = !hasContacts;
	if (!hasContacts) closeSavedContactOptions();
	else filterSavedContactOptions();
}

function filterSavedContactOptions(forceOpen = false) {
	const picker = document.getElementById("savedContactPicker");
	if (!picker) return;
	const menu = picker.querySelector(".styledDropdownMenu");
	const query = normalizeContactName(custName.value);
	const matches = savedInvoiceContacts.filter(contact => normalizeContactName(contact.name).includes(query));
	menu.replaceChildren();
	matches.slice(0, 50).forEach(contact => {
		const option = document.createElement("button");
		option.type = "button";
		option.className = "styledDropdownOption savedContactOption";
		option.setAttribute("role", "option");
		option.setAttribute("aria-selected", "false");
		const name = document.createElement("span");
		name.className = "savedContactOptionName";
		name.textContent = contact.name;
		const details = document.createElement("span");
		details.className = "savedContactOptionDetails";
		details.textContent = [contact.address, contact.email && `Email ${contact.email}`, contact.phone && `Phone ${contact.phone}`, contact.trn && `TRN ${contact.trn}`]
			.filter(Boolean).join(" · ");
		option.append(name, details);
		option.addEventListener("click", () => {
			custName.value = contact.name;
			fillSavedContactDetails(contact);
			closeSavedContactOptions();
			custName.focus();
			updateInvoice();
		});
		option.addEventListener("keydown", event => {
			const options = Array.from(menu.querySelectorAll('[role="option"]'));
			const index = options.indexOf(option);
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				options[(index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length].focus();
			} else if (event.key === "Escape") {
				event.preventDefault();
				closeSavedContactOptions();
				custName.focus();
			}
		});
		menu.appendChild(option);
	});
	const open = matches.length > 0 && (forceOpen || document.activeElement === custName);
	picker.classList.toggle("open", open);
	custName.setAttribute("aria-expanded", String(open));
	picker.querySelector(".savedContactToggle").setAttribute("aria-expanded", String(open));
}

function toggleSavedContactOptions() {
	const picker = document.getElementById("savedContactPicker");
	if (picker.classList.contains("open")) closeSavedContactOptions();
	else filterSavedContactOptions(true);
}

function closeSavedContactOptions(event) {
	const picker = document.getElementById("savedContactPicker");
	if (!picker || (event && picker.contains(event.target))) return;
	picker.classList.remove("open");
	custName.setAttribute("aria-expanded", "false");
	picker.querySelector(".savedContactToggle").setAttribute("aria-expanded", "false");
}

function handleSavedContactKeydown(event) {
	const picker = document.getElementById("savedContactPicker");
	if (event.key === "Escape") {
		closeSavedContactOptions();
	} else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
		event.preventDefault();
		if (!picker.classList.contains("open")) filterSavedContactOptions(true);
		const options = picker.querySelectorAll('[role="option"]');
		const target = event.key === "ArrowDown" ? options[0] : options[options.length - 1];
		if (target) target.focus();
	}
}

function filterSavedItemOptions(input, values = []) {
	const picker = input.closest(".itemFieldPicker");
	if (!picker) return;
	const menu = picker.querySelector(".savedItemOptions");
	if (!menu) return;
	const query = normalizeSavedItemValue(input.value).toLowerCase();
	const matches = values.filter(value => value.toLowerCase().includes(query));
	menu.replaceChildren();
	matches.slice(0, 50).forEach(value => {
		const option = document.createElement("button");
		option.type = "button";
		option.className = "styledDropdownOption";
		option.setAttribute("role", "option");
		option.setAttribute("aria-selected", "false");
		option.textContent = value;
		option.addEventListener("click", () => {
			input.value = value;
			closeSavedItemFieldOptions(input);
			input.focus();
			updateInvoice();
		});
		option.addEventListener("keydown", event => {
			const options = Array.from(menu.querySelectorAll('[role="option"]'));
			const index = options.indexOf(option);
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				options[(index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length].focus();
			} else if (event.key === "Escape") {
				event.preventDefault();
				closeSavedItemFieldOptions(input);
				input.focus();
			}
		});
		menu.appendChild(option);
	});
	const open = matches.length > 0 && (document.activeElement === input || input.matches(":focus"));
	picker.classList.toggle("open", open);
	input.setAttribute("aria-expanded", String(open));
	const toggle = picker.querySelector(".savedItemToggle");
	if (toggle) toggle.setAttribute("aria-expanded", String(open));
}

function toggleSavedItemFieldOptions(input) {
	const picker = input && input.closest(".itemFieldPicker");
	if (!picker) return;
	if (picker.classList.contains("open")) closeSavedItemFieldOptions(input);
	else {
		const values = input.classList.contains("itemBrand") ? savedItemBrandModels
			: input.classList.contains("itemRef") ? savedItemReferenceNumbers
			: savedItemSerialNumbers;
		filterSavedItemOptions(input, values);
		picker.classList.add("open");
		input.setAttribute("aria-expanded", "true");
		const toggle = picker.querySelector(".savedItemToggle");
		if (toggle) toggle.setAttribute("aria-expanded", "true");
	}
}

function closeSavedItemFieldOptions(input) {
	const picker = input && input.closest(".itemFieldPicker");
	if (!picker) return;
	picker.classList.remove("open");
	input.setAttribute("aria-expanded", "false");
	const toggle = picker.querySelector(".savedItemToggle");
	if (toggle) toggle.setAttribute("aria-expanded", "false");
}

function handleSavedItemFieldKeydown(event, input) {
	const picker = input && input.closest(".itemFieldPicker");
	if (!picker) return;
	if (event.key === "Escape") {
		closeSavedItemFieldOptions(input);
	} else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
		event.preventDefault();
		if (!picker.classList.contains("open")) {
			const values = input.classList.contains("itemBrand") ? savedItemBrandModels
				: input.classList.contains("itemRef") ? savedItemReferenceNumbers
				: savedItemSerialNumbers;
			filterSavedItemOptions(input, values);
		}
		const options = picker.querySelectorAll('[role="option"]');
		const target = event.key === "ArrowDown" ? options[0] : options[options.length - 1];
		if (target) target.focus();
	}
}

function lookupSavedItemBySerial(input) {
	if (!input) return;
	const value = normalizeSavedItemValue(input.value);
	if (!value) return;
	const matches = savedItemSerialNumbers.filter(item => item.toLowerCase().includes(value.toLowerCase()));
	const picker = input.closest(".itemFieldPicker");
	if (picker) {
		picker.classList.toggle("open", matches.length > 0 && document.activeElement === input);
		const toggle = picker.querySelector(".savedItemToggle");
		if (toggle) toggle.setAttribute("aria-expanded", String(matches.length > 0 && document.activeElement === input));
	}
}

function collectSavedInvoiceMetadata(invoices) {
	const seen = new Set();
	const highestSequences = Object.fromEntries(Object.keys(INVOICE_TYPES).map(type => [type, 0]));
	savedInvoiceContacts = [];
	savedItemBrandModels = [];
	savedItemReferenceNumbers = [];
	savedItemSerialNumbers = [];

	invoices.forEach(invoice => {
		const invoiceType = normalizeInvoiceType(invoice.type);
		highestSequences[invoiceType] = Math.max(highestSequences[invoiceType], parseInt(invoice.invoiceNo, 10) || 0);
		const customer = invoice.customer && typeof invoice.customer === "object" ? invoice.customer : {};
		const name = String(customer.name || "").trim();
		const key = normalizeContactName(name);
		if (!name || seen.has(key)) return;
		seen.add(key);
		savedInvoiceContacts.push({
			name,
			address: customer.address || "",
			email: customer.email || "",
			phone: customer.phone || "",
			trn: customer.trn || ""
		});
		if (Array.isArray(invoice.items)) {
			invoice.items.forEach(item => {
				addUniqueSavedItemValue(savedItemBrandModels, item.brand || item.itemBrand || item.model || "");
				addUniqueSavedItemValue(savedItemReferenceNumbers, item.reference || item.itemRef || item.ref || item.referenceNumber || "");
				addUniqueSavedItemValue(savedItemSerialNumbers, item.serialNumber || item.itemSerial || item.serial || item.sn || "");
			});
		}
	});

	Object.keys(INVOICE_TYPES).forEach(type => {
		nextInvoiceSequences[type] = Math.max(nextInvoiceSequences[type] || 1, highestSequences[type] + 1);
	});
	invoiceSequencesReady = true;
	refreshSavedContactOptions();
	updateInvoice();
}

async function loadSavedContacts() {
	if (!auth.currentUser || !isFirebaseConfigured() || !navigator.onLine) {
		collectSavedInvoiceMetadata(getLocalInvoices());
		return;
	}
	try {
		const snapshot = await db.collection("users").doc(auth.currentUser.uid).collection("invoices")
			.orderBy("createdAt", "desc").get();
		const invoices = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
		collectSavedInvoiceMetadata(invoices);
	} catch (error) {
		console.error("Could not load saved invoices and customer details:", error);
		invoiceSequencesReady = true;
		refreshSavedContactOptions();
		updateInvoice();
	}
}

function fillSavedContactDetails(contact = null) {
	if (!contact) {
		const name = normalizeContactName(custName.value);
		contact = savedInvoiceContacts.find(saved => normalizeContactName(saved.name) === name);
	}
	if (!contact) return;
	custName.value = contact.name;
	custAddress.value = contact.address;
	custEmail.value = contact.email || "";
	custPhone.value = contact.phone;
	custTRN.value = contact.trn;
	updateInvoice();
}

function rememberSavedContact(invoice) {
	const customer = invoice.customer || {};
	const name = String(customer.name || "").trim();
	if (!name) return;
	const key = normalizeContactName(name);
	const index = savedInvoiceContacts.findIndex(contact => normalizeContactName(contact.name) === key);
	const contact = { name, address: customer.address || "", email: customer.email || "", phone: customer.phone || "", trn: customer.trn || "" };
	if (index === -1) savedInvoiceContacts.unshift(contact);
	else savedInvoiceContacts[index] = contact;
	refreshSavedContactOptions();
}

function rememberSavedItemValues(invoice) {
	if (!invoice || !Array.isArray(invoice.items)) return;
	invoice.items.forEach(item => {
		addUniqueSavedItemValue(savedItemBrandModels, item.brand || item.itemBrand || item.model || "");
		addUniqueSavedItemValue(savedItemReferenceNumbers, item.reference || item.itemRef || item.ref || item.referenceNumber || "");
		addUniqueSavedItemValue(savedItemSerialNumbers, item.serialNumber || item.itemSerial || item.serial || item.sn || "");
	});
}

function formatInvoiceNumber(type, date, number) {
	if (type === "purchase") type = "purchase_tax";
	const kind = INVOICE_TYPES[type] || INVOICE_TYPES.sales;
	const parts = (date || new Date().toISOString().slice(0, 10)).split("-");
	const year = parts[0] || String(new Date().getFullYear());
	const day = parts[2] || "01";
	const month = parts[1] || "01";
	const dayMonth = `${day}${month}`;
	const sequence = parseInt(number, 10) || 1;
	return `${kind.prefix}-${year}-${dayMonth}-${String(sequence).padStart(6, "0")}`;
}

function getInvoiceSequence() {
	const type = normalizeInvoiceType(document.getElementById("invoiceType").value);
	return nextInvoiceSequences[type] || 1;
}

function editInvoiceNumber() {
	invoiceNumberManuallyEdited = Boolean(invNo.value.trim());
	updateInvoice();
}

function setInvoiceType(type) {
	if (type === "purchase") type = "purchase_tax";
	if (!INVOICE_TYPES[type]) type = "sales";
	document.getElementById("invoiceType").value = type;
	if (typeof syncStyledDropdown === "function") syncStyledDropdown(document.getElementById("invoiceType"));
	if (type === "purchase_non_vat") document.getElementById("vatRate").value = 0;
	document.getElementById("partyHeading").textContent = INVOICE_TYPES[type].party;
	document.getElementById("billLabelEn").textContent = INVOICE_TYPES[type].bill;
	document.getElementById("taxTitleEn").textContent = INVOICE_TYPES[type].label.toUpperCase();
	document.getElementById("taxTitleAr").textContent = INVOICE_TYPES[type].arabic;
	refreshSavedContactOptions();
	updateInvoice();
}

function initInvoiceForm(profile) {
	const savedSequences = profile.nextInvoiceNumber && typeof profile.nextInvoiceNumber === "object"
		? profile.nextInvoiceNumber
		: (profile.nextInvoiceNumbers || {});
	nextInvoiceSequences = Object.fromEntries(Object.keys(INVOICE_TYPES).map(type => [
		type,
		Math.max(1, parseInt(savedSequences[type], 10) || 1)
	]));
	invoiceSequencesReady = true;
	invoiceNumberManuallyEdited = false;
	currentSavedInvoiceId = null;
	updateEditorActionButtons();
	if (typeof initStyledDropdowns === "function") initStyledDropdowns(document.querySelector(".editor"));
	if (!document._savedContactOutsideHandler) {
		document.addEventListener("click", closeSavedContactOptions);
		document._savedContactOutsideHandler = true;
	}

	if (!invDate.value) {
		invDate.value = new Date().toISOString().split("T")[0];
	}

	refreshSavedContactOptions();
	loadSavedContacts();
	syncPendingLocalInvoices(profile);
	if (!localInvoiceSyncOnlineHandler) {
		localInvoiceSyncOnlineHandler = () => syncPendingLocalInvoices(profile);
		window.addEventListener("online", localInvoiceSyncOnlineHandler);
	}
	updateInvoice();
	const invoiceId = new URLSearchParams(window.location.search).get("invoiceId");
	if (invoiceId) loadInvoiceIntoEditor(invoiceId);
}

async function syncPendingLocalInvoices(profile) {
	if (!auth.currentUser || !isFirebaseConfigured() || !navigator.onLine) return;
	const status = document.getElementById("saveStatus");
	try {
		const count = await syncLocalInvoicesToFirestore(auth.currentUser, profile);
		if (count && status) {
			status.textContent = `Synced ${count} invoice${count === 1 ? "" : "s"} to Firestore.`;
			setTimeout(() => { if (status.textContent.startsWith("Synced ")) status.textContent = ""; }, 4000);
		}
	} catch (error) {
		console.error("Could not sync locally saved invoices to Firestore:", error);
		if (status) status.textContent = "Could not sync saved invoices. They remain on this device; please retry.";
	}
}

function formatMoney(n) {
	return (n || 0).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sanitizePhone(input) {
	const cleaned = input.value.replace(/[^0-9+\-\s()]/g, "");
	if (cleaned !== input.value) {
		input.value = cleaned;
	}
}

function collectInvoiceData() {
	const items = [...document.querySelectorAll(".itemRow")].map(row => {
		const itemBrand = row.querySelector(".itemBrand")?.value.trim() || "";
		const itemRef = row.querySelector(".itemRef")?.value.trim() || "";
		const itemSerial = row.querySelector(".itemSerial")?.value.trim() || "";
		const desc = getItemDescriptionText(row);
		return {
			desc,
			brand: itemBrand,
			reference: itemRef,
			serialNumber: itemSerial,
			qty: parseFloat(row.querySelector(".qty").value) || 0,
			price: parseFloat(row.querySelector(".price").value) || 0
		};
	});

	const payments = [...document.querySelectorAll(".paymentRow")].map(row => ({
		mode: row.querySelector(".payMode").value,
		ref: row.querySelector(".payRef").value || "",
		amount: parseFloat(row.querySelector(".payAmount").value) || 0
	}));

	return {
		invoiceNo: currentSavedInvoiceSequence == null ? getInvoiceSequence() : currentSavedInvoiceSequence,
		invoiceDisplayNo: invNo.value.trim(),
		type: document.getElementById("invoiceType").value || "sales",
		vatRate: parseFloat(document.getElementById("vatRate").value) || 0,
		date: invDate.value,
		customer: {
			name: custName.value,
			address: custAddress.value,
			email: custEmail.value.trim(),
			phone: custPhone.value,
			trn: custTRN.value
		},
		items: items,
		payments: payments,
		grandTotal: parseFloat((grandTotal.innerText || "0").replace(/,/g, "")) || 0
	};
}

async function saveCurrentInvoiceLocally(statusElId, advanceSequence = true) {
	if (!invoiceSequencesReady) {
		if (statusElId) document.getElementById(statusElId).textContent = "Invoice numbering is still loading. Please try again.";
		return false;
	}
	if (!invNo.value.trim()) {
		alert("Please enter an invoice number or restore the automatic number.");
		invNo.focus();
		return false;
	}

	const profile = getLocalProfile(currentUser() || "demo");
	const localInvoices = getLocalInvoices();
	const data = collectInvoiceData();
	const type = normalizeInvoiceType(data.type);
	const isEditingSavedInvoice = Boolean(currentSavedInvoiceId);
	const nextNumbers = profile.nextInvoiceNumber && typeof profile.nextInvoiceNumber === "object"
		? profile.nextInvoiceNumber
		: createInitialInvoiceSequences();

	if (isEditingSavedInvoice) {
		const index = localInvoices.findIndex(invoice => invoice.id === currentSavedInvoiceId);
		if (index === -1) {
			if (statusElId) document.getElementById(statusElId).textContent = "Could not update the saved local invoice.";
			return false;
		}
		localInvoices[index] = {
			...localInvoices[index],
			...data,
			updatedAt: Date.now(),
			id: currentSavedInvoiceId
		};
		setLocalInvoices(localInvoices);
	} else {
		const nextSequence = Math.max(parseInt(nextNumbers[type], 10) || 1, nextInvoiceSequences[type] || 1);
		const invoiceId = `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
		data.invoiceNo = nextSequence;
		if (!invoiceNumberManuallyEdited) data.invoiceDisplayNo = formatInvoiceNumber(type, data.date, nextSequence);
		localInvoices.unshift({
			id: invoiceId,
			ownerId: auth.currentUser ? auth.currentUser.uid : profile.uid,
			ownerUsername: profile.username,
			...data,
			createdAt: Date.now()
		});
		profile.nextInvoiceNumber = { ...nextNumbers, [type]: nextSequence + 1 };
		saveLocalProfile(profile);
		setLocalInvoices(localInvoices);
		currentSavedInvoiceId = invoiceId;
		currentSavedInvoiceSequence = data.invoiceNo;
		nextInvoiceSequences[type] = nextSequence + 1;
	}

	rememberSavedContact(data);
	rememberSavedItemValues(data);
	if (advanceSequence) {
		invoiceNumberManuallyEdited = false;
		updateInvoice();
	}
	if (statusElId) {
		const el = document.getElementById(statusElId);
		if (el) { el.textContent = "Saved locally."; setTimeout(() => { el.textContent = ""; }, 2000); }
	}
	return true;
}

// Saves the current invoice and reserves its type-specific sequence atomically.
async function saveCurrentInvoice(statusElId, advanceSequence = true) {
	if (currentSavedInvoiceId && currentSavedInvoiceId.startsWith("local-")) {
		if (!auth.currentUser || !isFirebaseConfigured() || !navigator.onLine) {
			return saveCurrentInvoiceLocally(statusElId, advanceSequence);
		}
		try {
			await syncLocalInvoicesToFirestore(auth.currentUser, getLocalProfile(currentUser()));
			currentSavedInvoiceId = `offline-${currentSavedInvoiceId}`;
		} catch (error) {
			console.error("Could not sync locally saved invoice before updating:", error);
			const status = statusElId && document.getElementById(statusElId);
			if (status) status.textContent = "Could not sync this invoice. It remains on this device; please retry.";
			return false;
		}
	}
	if (!auth.currentUser || !isFirebaseConfigured() || !navigator.onLine) {
		return saveCurrentInvoiceLocally(statusElId, advanceSequence);
	}
	if (!invoiceSequencesReady) {
		if (statusElId) document.getElementById(statusElId).textContent = "Invoice numbering is still loading. Please try again.";
		return false;
	}
	if (!invNo.value.trim()) {
		alert("Please enter an invoice number or restore the automatic number.");
		invNo.focus();
		return false;
	}
	const uid = auth.currentUser.uid;
	const data = collectInvoiceData();
	const userRef = db.collection("users").doc(uid);
	const invoiceCollection = userRef.collection("invoices");
	const isEditingSavedInvoice = Boolean(currentSavedInvoiceId);

	try {
		await syncLocalInvoicesToFirestore(auth.currentUser, getLocalProfile(currentUser()));
		if (isEditingSavedInvoice) {
			const invoiceRef = invoiceCollection.doc(currentSavedInvoiceId);
			await db.runTransaction(async transaction => {
				const previousSnapshot = await transaction.get(invoiceRef);
				if (!previousSnapshot.exists) throw new Error("The invoice being edited no longer exists.");
				transaction.update(invoiceRef, {
					...data,
					updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
					revisionOf: firebase.firestore.FieldValue.delete(),
					replacedBy: firebase.firestore.FieldValue.delete(),
					revisedAt: firebase.firestore.FieldValue.delete()
				});
			});
		} else {
			const invoiceRef = invoiceCollection.doc();
			const manuallyEditedNumber = invoiceNumberManuallyEdited;
			await db.runTransaction(async transaction => {
				const profileSnapshot = await transaction.get(userRef);
				const profile = profileSnapshot.data() || {};
				const storedSequences = profile.nextInvoiceNumber && typeof profile.nextInvoiceNumber === "object"
					? profile.nextInvoiceNumber
					: (profile.nextInvoiceNumbers || {});
				const type = normalizeInvoiceType(data.type);
				const sequence = Math.max(
					parseInt(storedSequences[type], 10) || 1,
					nextInvoiceSequences[type] || 1
				);
				const nextSequences = Object.fromEntries(Object.keys(INVOICE_TYPES).map(invoiceType => [
					invoiceType,
					Math.max(parseInt(storedSequences[invoiceType], 10) || 1, nextInvoiceSequences[invoiceType] || 1)
				]));
				nextSequences[type] = sequence + 1;
				data.invoiceNo = sequence;
				if (!manuallyEditedNumber) data.invoiceDisplayNo = formatInvoiceNumber(type, data.date, sequence);
				transaction.set(invoiceRef, {
					...data,
					createdAt: firebase.firestore.FieldValue.serverTimestamp()
				});
				transaction.set(userRef, {
					nextInvoiceNumber: nextSequences
				}, { merge: true });
			});
			currentSavedInvoiceId = invoiceRef.id;
			currentSavedInvoiceSequence = data.invoiceNo;
			nextInvoiceSequences[normalizeInvoiceType(data.type)] = data.invoiceNo + 1;
		}
		rememberSavedContact(data);
		rememberSavedItemValues(data);
		if (advanceSequence) {
			invoiceNumberManuallyEdited = false;
			updateInvoice();
		}
		if (statusElId) {
			const el = document.getElementById(statusElId);
			if (el) { el.textContent = "Saved."; setTimeout(() => { el.textContent = ""; }, 2000); }
		}
		return true;
	} catch (err) {
		console.error("Could not save invoice:", err);
		if (statusElId) {
			const el = document.getElementById(statusElId);
			if (el) el.textContent = "Could not save - check your connection.";
		}
		return false;
	}
}

function updateEditorActionButtons() {
	const updateButton = document.getElementById("updateInvoiceButton");
	if (updateButton) updateButton.hidden = !currentSavedInvoiceId;
}

async function updateCurrentInvoice() {
	if (!currentSavedInvoiceId) return;
	const updated = await saveCurrentInvoice("saveStatus", false);
	if (updated) {
		setTimeout(() => {
			window.location.href = "saved-invoices.html";
		}, 250);
	}
}

function validateInvoiceForPrint() {
	if (!custName.value.trim()) {
		alert("Please enter a customer name before printing or sharing.");
		custName.focus();
		return false;
	}

	if (document.querySelectorAll(".itemRow").length === 0) {
		alert("Please add at least one item before printing or sharing.");
		return false;
	}
	return true;
}

async function saveAndPrintInvoice() {
	const invoiceType = normalizeInvoiceType(document.getElementById("invoiceType").value);
	const invoiceNumberForPdf = invNo.value.trim() || formatInvoiceNumber(invoiceType, invDate.value, getInvoiceSequence());
	const isLocalSave = Boolean(currentSavedInvoiceId && currentSavedInvoiceId.startsWith("local-"))
		|| !auth.currentUser || !isFirebaseConfigured() || !navigator.onLine;
	const saved = await saveCurrentInvoice("saveStatus", false);
	if (!saved) return null;
	const nextSequence = nextInvoiceSequences[invoiceType] || getInvoiceSequence() + 1;
	const originalTitle = document.title;
	document.title = invoiceNumberForPdf.replace(/[\\/:*?"<>|]/g, "-") || "Invoice";
	try {
		document.getElementById("saveStatus").textContent = isLocalSave
			? "Saved on this device. Opening print dialog..."
			: "Saved. Opening print dialog...";
		window.print();
	} finally {
		document.title = originalTitle;
	}
	return { invoiceType, nextSequence };
}

async function printInvoice() {
	if (!validateInvoiceForPrint()) return;
	const printButton = document.getElementById("printInvoiceButton");
	const status = document.getElementById("saveStatus");
	printButton.disabled = true;
	status.textContent = "Saving invoice...";
	try {
		const printResult = await saveAndPrintInvoice();
		if (!printResult) return;
		nextInvoiceSequences[printResult.invoiceType] = printResult.nextSequence;
		currentSavedInvoiceId = null;
		currentSavedInvoiceSequence = null;
		updateEditorActionButtons();
		const url = new URL(window.location.href);
		url.searchParams.delete("invoiceId");
		window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
		invoiceNumberManuallyEdited = false;
		status.textContent = "Print dialog closed. Returning to a new invoice...";
		setTimeout(() => {
			window.location.href = "home.html";
		}, 1500);
	} catch (error) {
		console.error("Could not open the invoice print dialog:", error);
		status.textContent = "Invoice saved, but the print dialog could not be opened. Please try again.";
	} finally {
		printButton.disabled = false;
	}
}

async function emailInvoiceToCustomer() {
	const email = custEmail.value.trim();
	if (!email) {
		alert("Enter the customer's email address first.");
		custEmail.focus();
		return;
	}
	if (!custEmail.checkValidity()) {
		custEmail.reportValidity();
		return;
	}
	if (!confirm("An email draft will open first. Then save the invoice as a PDF, attach it, and send.")) return;
	if (!validateInvoiceForPrint()) return;

	const invoiceType = document.getElementById("invoiceType").value || "sales";
	const invoiceLabel = (INVOICE_TYPES[invoiceType] || INVOICE_TYPES.sales).label.toLowerCase();
	const invoiceNumber = invNo.value.trim() || formatInvoiceNumber(invoiceType, invDate.value, getInvoiceSequence());
	const descriptions = [...document.querySelectorAll(".itemRow")]
		.map(row => getItemDescriptionText(row).trim())
		.filter(Boolean);
	const itemsText = descriptions.length ? descriptions.join(", ") : "your purchase";
	const total = formatMoney(parseFloat((grandTotal.innerText || "0").replace(/,/g, "")) || 0);
	const balance = parseFloat((document.getElementById("balanceDue").innerText || "0").replace(/,/g, "")) || 0;
	const balanceText = balance <= 0.01 ? "fully settled" : `AED ${formatMoney(balance)} remains due`;
	const firstName = custName.value.trim().split(/\s+/)[0] || "Customer";
	const subject = `${invoiceNumber} | TEIMOOR JAAFAR WATCHES`;
	const body = [
		`Dear ${firstName},`,
		"",
		"Thank you for choosing TEIMOOR JAAFAR WATCHES!",
		"",
		`To support a greener environment, we are providing your ${invoiceLabel} digitally today.`,
		"",
		`I have attached your final invoice for ${itemsText} (Total: AED ${total}). The balance is ${balanceText}.`,
		"",
		"Please let us know if you have any questions. We appreciate your business!",
		"",
		"Kind regards,",
		"TEIMOOR JAAFAR WATCHES"
	].join("\n");
	const emailUrl = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
	window.open(emailUrl, "_blank", "noopener");
	await saveAndPrintInvoice();
}

async function whatsappInvoiceToCustomer() {
	const rawPhone = custPhone.value.trim();
	if (!rawPhone) {
		alert("Enter the customer's phone number first.");
		custPhone.focus();
		return;
	}

	let phone = rawPhone.replace(/\D/g, "");
	if (phone.startsWith("00")) phone = phone.slice(2);
	else if (phone.startsWith("0")) phone = `971${phone.slice(1)}`;
	if (phone.length < 7) {
		alert("Enter a valid customer phone number with the country code.");
		custPhone.focus();
		return;
	}
	if (!validateInvoiceForPrint()) return;

	const invoiceType = document.getElementById("invoiceType").value || "sales";
	const invoiceLabel = (INVOICE_TYPES[invoiceType] || INVOICE_TYPES.sales).label.toLowerCase();
	const invoiceNumber = invNo.value.trim() || formatInvoiceNumber(invoiceType, invDate.value, getInvoiceSequence());
	const total = formatMoney(parseFloat((grandTotal.innerText || "0").replace(/,/g, "")) || 0);
	const balance = parseFloat((document.getElementById("balanceDue").innerText || "0").replace(/,/g, "")) || 0;
	const balanceText = balance <= 0.01 ? "fully settled" : `AED ${formatMoney(balance)} remains due`;
	const firstName = custName.value.trim().split(/\s+/)[0] || "Customer";
	const message = [
		`Dear ${firstName},`,
		"",
		`Please find your ${invoiceLabel} ${invoiceNumber}.`,
		`Total: AED ${total}. The balance is ${balanceText}.`,
		"Please let us know if you have any questions."
	].join("\n");
	const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
	window.open(whatsappUrl, "_blank", "noopener");
	await saveAndPrintInvoice();
}

function addItem() {
	let div = document.createElement("div");
	div.className = "itemRow";

	div.innerHTML = `
		<div class="itemFieldPicker" aria-label="Saved item brand models">
			<input type="text" class="itemBrand" placeholder="Brand / Model Name" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="itemSavedOptions" oninput="filterSavedItemOptions(this, savedItemBrandModels); updateInvoice()" onkeydown="handleSavedItemFieldKeydown(event, this)">
			<button class="savedItemToggle" type="button" aria-label="Show saved item brand models" aria-expanded="false" onclick="toggleSavedItemFieldOptions(this.previousElementSibling)"><span class="styledDropdownChevron" aria-hidden="true"></span></button>
			<div class="savedItemOptions styledDropdownMenu" role="listbox" aria-label="Saved item brand models"></div>
		</div>
		<div class="itemMetaRow">
			<div class="itemFieldPicker" aria-label="Saved item references">
				<input type="text" class="itemRef" placeholder="Reference Number (Ref.)" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="itemRefSavedOptions" oninput="filterSavedItemOptions(this, savedItemReferenceNumbers); updateInvoice()" onkeydown="handleSavedItemFieldKeydown(event, this)">
				<button class="savedItemToggle" type="button" aria-label="Show saved item references" aria-expanded="false" onclick="toggleSavedItemFieldOptions(this.previousElementSibling)"><span class="styledDropdownChevron" aria-hidden="true"></span></button>
				<div class="savedItemOptions styledDropdownMenu" role="listbox" aria-label="Saved item references"></div>
			</div>
			<div class="itemFieldPicker" aria-label="Saved item serial numbers">
				<input type="text" class="itemSerial" placeholder="Serial Number (S/N)" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="itemSerialSavedOptions" oninput="filterSavedItemOptions(this, savedItemSerialNumbers); updateInvoice()" onblur="lookupSavedItemBySerial(this)" onkeydown="handleSavedItemFieldKeydown(event, this)">
				<button class="savedItemToggle" type="button" aria-label="Show saved item serial numbers" aria-expanded="false" onclick="toggleSavedItemFieldOptions(this.previousElementSibling)"><span class="styledDropdownChevron" aria-hidden="true"></span></button>
				<div class="savedItemOptions styledDropdownMenu" role="listbox" aria-label="Saved item serial numbers"></div>
			</div>
		</div>
		<div class="itemValueRow">
			<input type="number" class="qty" value="1" oninput="updateInvoice()">
			<input type="number" class="price" placeholder="Unit Price Incl VAT" oninput="updateInvoice()">
		</div>
		<button type="button" aria-label="Remove item" title="Remove item" onclick="removeItem(this)">−</button>
	`;

	document.getElementById("itemList").appendChild(div);
}

function removeItem(btn) {
	btn.parentElement.remove();
	updateInvoice();
}

function addPayment() {
	let div = document.createElement("div");
	div.className = "paymentRow";

	div.innerHTML = `
		<select class="payMode" onchange="updateInvoice()">
			<option>CASH</option>
			<option>CARD</option>
			<option>BANK TRANSFER</option>
			<option>CHEQUE</option>
		</select>
		<input type="text" class="payRef" placeholder="Reference" oninput="updateInvoice()">
		<input type="number" class="payAmount" placeholder="Amount" oninput="updateInvoice()">
		<button type="button" aria-label="Remove payment method" title="Remove payment method" onclick="removePayment(this)">−</button>
	`;

	document.getElementById("paymentList").appendChild(div);
	if (typeof enhanceStyledDropdown === "function") enhanceStyledDropdown(div.querySelector(".payMode"));
}

function removePayment(btn) {
	btn.parentElement.remove();
	updateInvoice();
}

function numberToWords(num) {
	const ones = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
		"Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
	const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
	const scales = [
		{ value: 1000000000, label: "Billion" },
		{ value: 1000000, label: "Million" },
		{ value: 1000, label: "Thousand" },
		{ value: 1, label: "" }
	];

	function convertUnderHundred(value) {
		const safeValue = Number(value);
		if (!Number.isFinite(safeValue) || safeValue <= 0) return "Zero";
		if (safeValue >= 100) return convertUnderThousand(safeValue);
		if (safeValue < 20) return ones[safeValue];
		const tensDigit = Math.floor(safeValue / 10);
		const remainder = safeValue % 10;
		if (remainder === 0) return tens[tensDigit] || "";
		return `${tens[tensDigit] || ""}-${ones[remainder] || ""}`.replace(/-+/g, "-").replace(/^-|-$/g, "").trim();
	}

	function convertUnderThousand(value) {
		const safeValue = Number(value);
		if (!Number.isFinite(safeValue) || safeValue <= 0) return "Zero";
		if (safeValue < 100) return convertUnderHundred(safeValue);
		const hundredsDigit = Math.floor(safeValue / 100);
		const remainder = safeValue % 100;
		if (remainder === 0) return `${ones[hundredsDigit] || ""} Hundred`.trim();
		return `${ones[hundredsDigit] || ""} Hundred and ${convertUnderHundred(remainder)}`.trim();
	}

	function convertNumber(value) {
		const safeValue = Number(value);
		if (!Number.isFinite(safeValue) || safeValue <= 0) return "Zero";
		let result = "";
		let remaining = Math.floor(safeValue);

		for (const scale of scales) {
			if (remaining >= scale.value) {
				const part = Math.floor(remaining / scale.value);
				if (part > 0) {
					const word = convertUnderThousand(part);
					result += `${word} ${scale.label} `.trim() + " ";
				}
				remaining %= scale.value;
			}
		}

		if (remaining > 0) {
			result += convertUnderThousand(remaining);
		}

		return result.trim();
	}

	const total = Math.max(0, Number(num) || 0);
	const dirhams = Math.floor(total);
	const fils = Math.round((total - dirhams) * 100);
	const dirhamLabel = dirhams === 1 ? "Dirham" : "Dirhams";
	const filLabel = fils === 1 ? "Fil" : "Fils";

	let words = `${convertNumber(dirhams)} ${dirhamLabel}`;
	if (fils > 0) {
		words += ` and ${convertNumber(fils)} ${filLabel}`;
	}

	return `${words} Only`;
}

function numberToArabicWords(num) {
	const ones = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة"];
	const hundreds = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];
	const tens = ["", "عشرة", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];

	function belowThousand(value) {
		if (value < 10) return ones[value];
		if (value < 20) {
			if (value === 10) return "عشرة";
			if (value === 11) return "أحد عشر";
			if (value === 12) return "اثنا عشر";
			return `${ones[value - 10]} عشر`;
		}
		if (value < 100) {
			const unit = value % 10;
			return unit ? `${ones[unit]} و${tens[Math.floor(value / 10)]}` : tens[Math.floor(value / 10)];
		}
		const remainder = value % 100;
		return remainder ? `${hundreds[Math.floor(value / 100)]} و${belowThousand(remainder)}` : hundreds[Math.floor(value / 100)];
	}

	function convert(value) {
		if (value === 0) return "صفر";
		const parts = [];
		const millions = Math.floor(value / 1000000);
		const thousands = Math.floor((value % 1000000) / 1000);
		const remainder = value % 1000;
		if (millions) parts.push(`${belowThousand(millions)} مليون`);
		if (thousands) parts.push(`${belowThousand(thousands)} ألف`);
		if (remainder) parts.push(belowThousand(remainder));
		return parts.join(" و");
	}

	const total = Math.max(0, Math.round((Number(num) || 0) * 100) / 100);
	const dirhams = Math.floor(total);
	const fils = Math.round((total - dirhams) * 100);
	let words = `${convert(dirhams)} درهم إماراتي`;
	if (fils) words += ` و${convert(fils)} فلس`;
	return `${words} فقط`;
}

function updateInvoice() {
	let invNumber = getInvoiceSequence();
	const formattedInvoiceNo = formatInvoiceNumber(document.getElementById("invoiceType").value, invDate.value, invNumber);
	if (!invoiceNumberManuallyEdited) invNo.value = formattedInvoiceNo;
	pInvNo.innerText = invNo.value.trim();
	pDate.innerText = invDate.value;

	pName.innerText = custName.value;
	pAddress.innerText = custAddress.value;
	pEmail.innerText = custEmail.value;
	pPhone.innerText = custPhone.value;
	pTRN.innerText = custTRN.value;

	let tbody = document.getElementById("invoiceItems");
	tbody.innerHTML = "";

	let subtotal = 0;
	let vatTotal = 0;
	const vatRate = parseFloat(document.getElementById("vatRate").value) || 0;

	document.querySelectorAll(".itemRow").forEach((row, i) => {
		const desc = getItemDescriptionText(row);
		let qty = parseFloat(row.querySelector(".qty").value) || 0;
		let price = parseFloat(row.querySelector(".price").value) || 0;

		let unitExcl = price / (1 + vatRate / 100);
		let taxable = unitExcl * qty;
		let vat = taxable * (vatRate / 100);
		let total = taxable + vat;

		subtotal += taxable;
		vatTotal += vat;

		let tr = document.createElement("tr");
		tr.innerHTML = `
			<td>#${i + 1}</td>
			<td class="desc">${desc.replace(/</g, "&lt;")}</td>
			<td>${qty}</td>
			<td>AED ${formatMoney(price)}</td>
			<td>AED ${formatMoney(unitExcl)}</td>
			<td>AED ${formatMoney(taxable)}</td>
			<td>${vatRate}%</td>
			<td>AED ${formatMoney(vat)}</td>
			<td>AED ${formatMoney(total)}</td>
		`;

		tbody.appendChild(tr);
	});

	let grand = subtotal + vatTotal;

	grandTotal.innerText = formatMoney(grand);
	pWords.innerText = numberToWords(grand);
	pWordsAr.innerText = numberToArabicWords(grand);

	let paymentBody = document.getElementById("paymentRows");
	paymentBody.innerHTML = "";

	let paidTotal = 0;

	document.querySelectorAll(".paymentRow").forEach(row => {
		let mode = row.querySelector(".payMode").value;
		let ref = row.querySelector(".payRef").value || "-";
		let amount = parseFloat(row.querySelector(".payAmount").value) || 0;

		paidTotal += amount;

		let taxable = amount / (1 + vatRate / 100);
		let vat = taxable * (vatRate / 100);

		let tr = document.createElement("tr");
		tr.innerHTML = `
			<td>${mode}</td>
			<td>${ref.replace(/</g, "&lt;")}</td>
			<td>AED</td>
			<td>AED ${formatMoney(taxable)}</td>
			<td>AED ${formatMoney(vat)}</td>
			<td>AED ${formatMoney(amount)}</td>
		`;

		paymentBody.appendChild(tr);
	});

	let balanceEl = document.getElementById("balanceDue");
	if (balanceEl) {
		let balance = grand - paidTotal;
		balanceEl.innerText = formatMoney(balance);
		balanceEl.style.color = balance > 0.01 ? "#b00000" : "#1a7a1a";
	}
}

function resetEditorForNewInvoice(nextInvoiceNo) {
	const type = normalizeInvoiceType(document.getElementById("invoiceType").value);
	if (nextInvoiceNo != null) nextInvoiceSequences[type] = parseInt(nextInvoiceNo, 10) || 1;
	currentSavedInvoiceId = null;
	currentSavedInvoiceSequence = null;
	invoiceNumberManuallyEdited = false;
	custName.value = "";
	custAddress.value = "";
	custEmail.value = "";
	custPhone.value = "";
	custTRN.value = "";
	document.getElementById("itemList").innerHTML = "";
	document.getElementById("paymentList").innerHTML = "";
	addItem();
	addPayment();
	updateInvoice();
}

// ---- Invoice history (Firestore) ----

async function loadInvoiceHistory() {
	const list = document.getElementById("invoiceHistoryList");
	if (!list || !auth.currentUser) return;

	list.innerHTML = "<li class='historyEmpty'>Loading...</li>";

	try {
		const uid = auth.currentUser.uid;
		const snap = await db.collection("users").doc(uid).collection("invoices")
			.orderBy("createdAt", "desc").limit(100).get();

		if (snap.empty) {
			list.innerHTML = "<li class='historyEmpty'>No saved invoices yet.</li>";
			return;
		}

		list.innerHTML = "";
		snap.forEach(doc => {
			const d = doc.data();
			const li = document.createElement("li");
			const custNameText = (d.customer && d.customer.name) ? d.customer.name : "Unnamed";
			const typeLabel = (INVOICE_TYPES[d.type === "purchase" ? "purchase_tax" : d.type] || INVOICE_TYPES.sales).label;
			const btn = document.createElement("button");
			btn.type = "button";
			btn.textContent = typeLabel + " · " + formatInvoiceNumber(d.type || "sales", d.date, d.invoiceNo) + " · " + custNameText + " · AED " + formatMoney(d.grandTotal);
			btn.onclick = () => loadInvoiceIntoEditor(doc.id);
			const download = document.createElement("button");
			download.type = "button";
			download.className = "historyDownload";
			download.textContent = "Download saved record";
			download.onclick = () => downloadSavedInvoice(doc.id);
			li.append(btn, download);
			list.appendChild(li);
		});
	} catch (err) {
		console.error("Could not load invoice history:", err);
		list.innerHTML = "<li class='historyEmpty'>Could not load history.</li>";
	}
}

async function downloadSavedInvoice(invoiceId) {
	try {
		if (invoiceId.startsWith("local-") && getLocalSavedInvoiceById(invoiceId)) {
			const data = getLocalSavedInvoiceById(invoiceId);
			const file = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
			const url = URL.createObjectURL(file);
			const link = document.createElement("a");
			link.href = url;
			const displayNo = data.invoiceDisplayNo || formatInvoiceNumber(data.type || "sales", data.date, data.invoiceNo);
			link.download = `${displayNo.replace(/[^A-Za-z0-9_-]/g, "_")}.json`;
			link.click();
			URL.revokeObjectURL(url);
			return;
		}
		if (!auth.currentUser || !isFirebaseConfigured() || !navigator.onLine) {
			const data = getLocalSavedInvoiceById(invoiceId);
			if (!data) return;
			const file = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
			const url = URL.createObjectURL(file);
			const link = document.createElement("a");
			link.href = url;
			const displayNo = data.invoiceDisplayNo || formatInvoiceNumber(data.type || "sales", data.date, data.invoiceNo);
			link.download = `${displayNo.replace(/[^A-Za-z0-9_-]/g, "_")}.json`;
			link.click();
			URL.revokeObjectURL(url);
			return;
		}
		if (invoiceId.startsWith("local-")) invoiceId = `offline-${invoiceId}`;
		const snap = await db.collection("users").doc(auth.currentUser.uid).collection("invoices").doc(invoiceId).get();
		if (!snap.exists) return;
		const data = snap.data();
		const file = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
		const url = URL.createObjectURL(file);
		const link = document.createElement("a");
		link.href = url;
		const displayNo = data.invoiceDisplayNo || formatInvoiceNumber(data.type || "sales", data.date, data.invoiceNo);
		link.download = `${displayNo.replace(/[^A-Za-z0-9_-]/g, "_")}.json`;
		link.click();
		URL.revokeObjectURL(url);
	} catch (err) {
		console.error("Could not download saved invoice:", err);
		alert("Could not download that invoice. Please check your connection.");
	}
}

async function loadInvoiceIntoEditor(invoiceId) {
	try {
		if (invoiceId.startsWith("local-") && !getLocalSavedInvoiceById(invoiceId) && auth.currentUser && isFirebaseConfigured() && navigator.onLine) {
			await syncLocalInvoicesToFirestore(auth.currentUser, getLocalProfile(currentUser()));
			return loadInvoiceIntoEditor(`offline-${invoiceId}`);
		}
		if ((invoiceId.startsWith("local-") && getLocalSavedInvoiceById(invoiceId)) || !auth.currentUser || !isFirebaseConfigured() || !navigator.onLine) {
			const d = getLocalSavedInvoiceById(invoiceId);
			if (!d) return;
			currentSavedInvoiceId = invoiceId;
			currentSavedInvoiceSequence = parseInt(d.invoiceNo, 10) || 1;
			updateEditorActionButtons();
			const url = new URL(window.location.href);
			url.searchParams.set("invoiceId", invoiceId);
			window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);

			invoiceNumberManuallyEdited = Boolean(d.invoiceDisplayNo);
			invNo.value = d.invoiceDisplayNo || "";
			setInvoiceType(d.type || "sales");
			document.getElementById("vatRate").value = d.vatRate == null ? 5 : d.vatRate;
			invDate.value = d.date;
			custName.value = d.customer.name;
			custAddress.value = d.customer.address;
			custEmail.value = d.customer.email || "";
			custPhone.value = d.customer.phone;
			custTRN.value = d.customer.trn;

			document.getElementById("itemList").innerHTML = "";
			(d.items || []).forEach(it => {
				addItem();
				const row = document.querySelector("#itemList .itemRow:last-child");
				if (row.querySelector(".itemBrand")) row.querySelector(".itemBrand").value = it.brand || it.itemBrand || "";
				if (row.querySelector(".itemRef")) row.querySelector(".itemRef").value = it.reference || it.itemRef || it.ref || "";
				if (row.querySelector(".itemSerial")) row.querySelector(".itemSerial").value = it.serialNumber || it.itemSerial || it.serial || "";
				const descField = row.querySelector(".desc");
				if (descField) descField.value = it.desc || "";
				row.querySelector(".qty").value = it.qty;
				row.querySelector(".price").value = it.price;
			});

			document.getElementById("paymentList").innerHTML = "";
			(d.payments || []).forEach(p => {
				addPayment();
				const row = document.querySelector("#paymentList .paymentRow:last-child");
				row.querySelector(".payMode").value = p.mode;
				if (typeof syncStyledDropdown === "function") syncStyledDropdown(row.querySelector(".payMode"));
				row.querySelector(".payRef").value = p.ref;
				row.querySelector(".payAmount").value = p.amount;
			});

			updateInvoice();
			return;
		}
		if (!auth.currentUser) return;
		const uid = auth.currentUser.uid;
		const doc = await db.collection("users").doc(uid).collection("invoices").doc(invoiceId).get();
		if (!doc.exists) return;
		const d = doc.data();
		currentSavedInvoiceId = invoiceId;
		currentSavedInvoiceSequence = parseInt(d.invoiceNo, 10) || 1;
		updateEditorActionButtons();
		const url = new URL(window.location.href);
		url.searchParams.set("invoiceId", invoiceId);
		window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);

		invoiceNumberManuallyEdited = Boolean(d.invoiceDisplayNo);
		invNo.value = d.invoiceDisplayNo || "";
		setInvoiceType(d.type || "sales");
		document.getElementById("vatRate").value = d.vatRate == null ? 5 : d.vatRate;
		invDate.value = d.date;
		custName.value = d.customer.name;
		custAddress.value = d.customer.address;
		custEmail.value = d.customer.email || "";
		custPhone.value = d.customer.phone;
		custTRN.value = d.customer.trn;

		document.getElementById("itemList").innerHTML = "";
		(d.items || []).forEach(it => {
			addItem();
			const row = document.querySelector("#itemList .itemRow:last-child");
			if (row.querySelector(".itemBrand")) row.querySelector(".itemBrand").value = it.brand || it.itemBrand || "";
			if (row.querySelector(".itemRef")) row.querySelector(".itemRef").value = it.reference || it.itemRef || it.ref || "";
			if (row.querySelector(".itemSerial")) row.querySelector(".itemSerial").value = it.serialNumber || it.itemSerial || it.serial || "";
			const descField = row.querySelector(".desc");
			if (descField) descField.value = it.desc || "";
			row.querySelector(".qty").value = it.qty;
			row.querySelector(".price").value = it.price;
		});

		document.getElementById("paymentList").innerHTML = "";
		(d.payments || []).forEach(p => {
			addPayment();
			const row = document.querySelector("#paymentList .paymentRow:last-child");
			row.querySelector(".payMode").value = p.mode;
			if (typeof syncStyledDropdown === "function") syncStyledDropdown(row.querySelector(".payMode"));
			row.querySelector(".payRef").value = p.ref;
			row.querySelector(".payAmount").value = p.amount;
		});

		updateInvoice();
	} catch (err) {
		console.error("Could not load invoice:", err);
		alert("Could not load that invoice - check your connection.");
	}
}
