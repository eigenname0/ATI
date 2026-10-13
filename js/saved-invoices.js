const SAVED_INVOICE_TYPES = {
	sales: "Sales Tax Invoice",
	purchase: "Purchase Tax Invoice",
	purchase_tax: "Purchase Tax Invoice",
	purchase_non_vat: "Purchase Non-Tax Invoice",
	commercial: "Commercial Invoice",
	consignment: "Consignment Invoice",
	proforma: "Pro Forma Invoice",
	credit: "Credit Note"
};

let savedInvoiceRecords = [];
let activeInvoiceStatus = "all";
let savedInvoicesUnsubscribe = null;
let savedInvoicesRefreshHandler = null;
let savedInvoiceFiltersWired = false;

function loadSavedInvoices(profile, user) {
	if (!savedInvoiceFiltersWired) {
		wireInvoiceDashboardFilters();
		savedInvoiceFiltersWired = true;
	}
	const refresh = () => {
		if (savedInvoicesUnsubscribe) {
			savedInvoicesUnsubscribe();
			savedInvoicesUnsubscribe = null;
		}
		if (!auth.currentUser || !isFirebaseConfigured() || !navigator.onLine) {
			savedInvoiceRecords = getLocalInvoicesForUser(user, profile).map(invoice => ({ id: invoice.id, ...invoice }));
			populateCustomerFilter();
			renderSavedInvoices();
			return;
		}

		const syncStatus = document.getElementById("invoiceSyncStatus");
		const pendingCount = getLocalInvoicesForUser(user, profile).length;
		if (pendingCount && syncStatus) syncStatus.textContent = `Syncing ${pendingCount} locally saved invoice${pendingCount === 1 ? "" : "s"} to Firestore...`;
		syncLocalInvoicesToFirestore(user, profile).then(count => {
			if (count && syncStatus) {
				syncStatus.textContent = `Synced ${count} invoice${count === 1 ? "" : "s"} to Firestore.`;
				setTimeout(() => { if (syncStatus.textContent.startsWith("Synced ")) syncStatus.textContent = ""; }, 4000);
			}
		}).catch(error => {
			console.error("Could not sync locally saved invoices to Firestore:", error);
			if (syncStatus) syncStatus.textContent = "Could not sync invoices. They remain on this device; reconnect and retry.";
		});

		savedInvoicesUnsubscribe = db.collection("users").doc(user.uid).collection("invoices")
			.orderBy("createdAt", "desc").onSnapshot(snapshot => {
				const cloudInvoices = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
				const thisUsersLocalInvoices = getLocalInvoicesForUser(user, profile)
					.map(invoice => ({ ...invoice }));
				savedInvoiceRecords = [...thisUsersLocalInvoices, ...cloudInvoices];
				populateCustomerFilter();
				renderSavedInvoices();
			}, error => {
				console.error("Could not load saved invoices:", error);
				showInvoiceEmptyState("Could not load saved invoices. Please check your connection and try again.");
			});
	};
	if (!savedInvoicesRefreshHandler) {
		savedInvoicesRefreshHandler = refresh;
		window.addEventListener("online", savedInvoicesRefreshHandler);
		window.addEventListener("offline", savedInvoicesRefreshHandler);
	}
	refresh();
	return () => {
		if (savedInvoicesUnsubscribe) savedInvoicesUnsubscribe();
		if (savedInvoicesRefreshHandler) {
			window.removeEventListener("online", savedInvoicesRefreshHandler);
			window.removeEventListener("offline", savedInvoicesRefreshHandler);
			savedInvoicesRefreshHandler = null;
		}
	};
}

function wireInvoiceDashboardFilters() {
	document.getElementById("savedSearch").addEventListener("input", renderSavedInvoices);
	document.getElementById("savedType").addEventListener("change", renderSavedInvoices);
	document.getElementById("customerFilter").addEventListener("change", renderSavedInvoices);
	document.querySelectorAll(".status-tab").forEach(button => {
		button.addEventListener("click", () => {
			activeInvoiceStatus = button.dataset.status;
			document.querySelectorAll(".status-tab").forEach(tab => {
				tab.classList.toggle("active", tab === button);
				tab.setAttribute("aria-pressed", String(tab === button));
			});
			renderSavedInvoices();
		});
	});

	const toggle = document.getElementById("filterToggle");
	const popover = document.getElementById("filterPopover");
	toggle.addEventListener("click", () => {
		popover.hidden = !popover.hidden;
		toggle.setAttribute("aria-expanded", String(!popover.hidden));
	});
	document.getElementById("applyFilters").addEventListener("click", () => {
		renderSavedInvoices();
		popover.hidden = true;
		toggle.setAttribute("aria-expanded", "false");
	});
	document.addEventListener("click", event => {
		if (!popover.hidden && !popover.contains(event.target) && !toggle.contains(event.target)) {
			popover.hidden = true;
			toggle.setAttribute("aria-expanded", "false");
		}
	});
	document.addEventListener("keydown", event => {
		if (event.key === "Escape" && !popover.hidden) {
			popover.hidden = true;
			toggle.setAttribute("aria-expanded", "false");
			toggle.focus();
		}
	});
}

function getSavedInvoiceType(record) {
	return record.type === "purchase" ? "purchase_tax" : (record.type || "sales");
}

function getSavedInvoiceNumber(record) {
	return record.invoiceDisplayNo || formatExportInvoiceNumber(getSavedInvoiceType(record), record.date, record.invoiceNo);
}

function getSavedInvoiceCustomer(record) {
	return (record.customer && record.customer.name) || "Unnamed customer";
}

function getSavedInvoicePaid(record) {
	return (record.payments || []).reduce((total, payment) => total + Math.max(0, Number(payment.amount) || 0), 0);
}

function getSavedInvoiceBalance(record) {
	return Math.max(0, (Number(record.grandTotal) || 0) - getSavedInvoicePaid(record));
}

function isSavedInvoicePaid(record) {
	return Number(record.grandTotal) > 0 && getSavedInvoiceBalance(record) < 0.005;
}

function formatSavedInvoiceMoney(amount) {
	return `AED ${Number(amount || 0).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function updateInvoiceDashboardSummary() {
	const total = savedInvoiceRecords.reduce((sum, record) => sum + (Number(record.grandTotal) || 0), 0);
	const paid = savedInvoiceRecords.reduce((sum, record) => sum + Math.min(Number(record.grandTotal) || 0, getSavedInvoicePaid(record)), 0);
	const counts = {
		all: savedInvoiceRecords.length,
		paid: savedInvoiceRecords.filter(isSavedInvoicePaid).length,
		unpaid: savedInvoiceRecords.filter(record => !isSavedInvoicePaid(record)).length
	};
	document.getElementById("summaryInvoiceCount").textContent = String(savedInvoiceRecords.length);
	document.getElementById("summaryInvoiceTotal").textContent = formatSavedInvoiceMoney(total);
	document.getElementById("summaryPaidTotal").textContent = formatSavedInvoiceMoney(paid);
	document.getElementById("summaryOutstanding").textContent = formatSavedInvoiceMoney(Math.max(0, total - paid));
	document.getElementById("countAll").textContent = String(counts.all);
	document.getElementById("countPaid").textContent = String(counts.paid);
	document.getElementById("countUnpaid").textContent = String(counts.unpaid);
}

function populateCustomerFilter() {
	const filter = document.getElementById("customerFilter");
	const selected = filter.value;
	const customers = [...new Set(savedInvoiceRecords.map(getSavedInvoiceCustomer).filter(name => name !== "Unnamed customer"))]
		.sort((left, right) => left.localeCompare(right));
	filter.replaceChildren(new Option("All customers", ""));
	customers.forEach(name => filter.add(new Option(name, name)));
	filter.value = customers.includes(selected) ? selected : "";
}

function renderSavedInvoices() {
	updateInvoiceDashboardSummary();
	const query = document.getElementById("savedSearch").value.trim().toLowerCase();
	const type = document.getElementById("savedType").value;
	const customerFilter = document.getElementById("customerFilter").value;
	const fromDate = document.getElementById("dateFrom").value;
	const toDate = document.getElementById("dateTo").value;
	const records = savedInvoiceRecords.filter(record => {
		const invoiceType = getSavedInvoiceType(record);
		const searchText = `${getSavedInvoiceNumber(record)} ${getSavedInvoiceCustomer(record)} ${SAVED_INVOICE_TYPES[invoiceType] || ""}`.toLowerCase();
		const statusMatches = activeInvoiceStatus === "all"
			|| (activeInvoiceStatus === "paid" && isSavedInvoicePaid(record))
			|| (activeInvoiceStatus === "unpaid" && !isSavedInvoicePaid(record));
		return searchText.includes(query)
			&& (type === "all" || invoiceType === type)
			&& (!customerFilter || getSavedInvoiceCustomer(record) === customerFilter)
			&& (!fromDate || String(record.date || "") >= fromDate)
			&& (!toDate || String(record.date || "") <= toDate)
			&& statusMatches;
	});

	const table = document.querySelector(".invoice-table");
	const list = document.getElementById("savedInvoiceRows");
	const empty = document.getElementById("savedEmptyState");
	table.hidden = records.length === 0;
	empty.hidden = records.length > 0;
	if (!records.length) {
		empty.textContent = savedInvoiceRecords.length ? "No invoices match these filters." : "No invoices have been saved yet.";
		return;
	}

	list.replaceChildren(...records.map(record => {
		const row = document.createElement("tr");
		const statusCell = document.createElement("td");
		const badge = document.createElement("span");
		const paid = isSavedInvoicePaid(record);
		badge.className = `invoice-badge ${paid ? "paid" : "unpaid"}`;
		badge.textContent = paid ? "Paid" : "Unpaid";
		statusCell.appendChild(badge);

		const dateCell = document.createElement("td");
		dateCell.textContent = record.date || "—";
		const numberCell = document.createElement("td");
		numberCell.className = "number";
		numberCell.textContent = getSavedInvoiceNumber(record);
		const customerCell = document.createElement("td");
		customerCell.textContent = getSavedInvoiceCustomer(record);
		const totalCell = document.createElement("td");
		totalCell.className = "money";
		totalCell.textContent = formatSavedInvoiceMoney(record.grandTotal);
		const balanceCell = document.createElement("td");
		balanceCell.className = "money";
		balanceCell.textContent = formatSavedInvoiceMoney(getSavedInvoiceBalance(record));
		const actionCell = document.createElement("td");
		const actions = document.createElement("div");
		actions.className = "invoice-row-actions";
		const open = document.createElement("button");
		open.type = "button";
		open.className = "openInvoiceButton";
		open.textContent = "Open";
		open.addEventListener("click", () => { window.location.href = `home.html?invoiceId=${encodeURIComponent(record.id)}`; });
		const remove = document.createElement("button");
		remove.type = "button";
		remove.className = "deleteInvoiceButton";
		remove.textContent = "−";
		remove.setAttribute("aria-label", `Delete invoice ${getSavedInvoiceNumber(record)}`);
		remove.title = "Delete saved invoice";
		remove.addEventListener("click", () => deleteSavedInvoice(record, remove));
		actions.append(open, remove);
		actionCell.appendChild(actions);
		row.append(statusCell, dateCell, numberCell, customerCell, totalCell, balanceCell, actionCell);
		return row;
	}));
}

function showInvoiceEmptyState(message) {
	const table = document.querySelector(".invoice-table");
	const empty = document.getElementById("savedEmptyState");
	if (table) table.hidden = true;
	if (empty) {
		empty.textContent = message;
		empty.hidden = false;
	}
}

async function deleteSavedInvoice(record, button) {
	const invoiceNo = record.invoiceDisplayNo || formatExportInvoiceNumber(record.type || "sales", record.date, record.invoiceNo);
	if (!confirm(`Delete invoice ${invoiceNo}? This cannot be undone.`)) return;

	button.disabled = true;
	if (record.id.startsWith("local-") && getLocalSavedInvoiceById(record.id)) {
		try {
			if (auth.currentUser && isFirebaseConfigured() && navigator.onLine) {
				await syncLocalInvoicesToFirestore(auth.currentUser, getLocalProfile(currentUser()));
				await db.collection("users").doc(auth.currentUser.uid).collection("invoices").doc(`offline-${record.id}`).delete();
			} else {
				setLocalInvoices(getLocalInvoices().filter(invoice => invoice.id !== record.id));
			}
			savedInvoiceRecords = savedInvoiceRecords.filter(invoice => invoice.id !== record.id);
			populateCustomerFilter();
			renderSavedInvoices();
		} catch (error) {
			console.error("Could not delete local saved invoice:", error);
			alert("Could not delete that invoice from this device.");
			button.disabled = false;
		}
		return;
	}
	if (!auth.currentUser) return;
	try {
		const invoiceId = record.id.startsWith("local-") ? `offline-${record.id}` : record.id;
		await db.collection("users").doc(auth.currentUser.uid).collection("invoices").doc(invoiceId).delete();
	} catch (error) {
		console.error("Could not delete saved invoice:", error);
		alert("Could not delete that invoice. Please check your connection and try again.");
		button.disabled = false;
	}
}

function exportSavedInvoices() {
	if (!savedInvoiceRecords.length) {
		alert("There are no saved invoices to export yet.");
		return;
	}
	const headers = ["Invoice Type", "Invoice Number", "Date", "Customer", "Email", "Address", "Phone", "TRN", "Item Description", "Quantity", "Unit Price Incl VAT (AED)", "VAT Rate (%)", "Line Total Incl VAT (AED)", "Invoice Total (AED)", "Payments"];
	const csvCell = value => {
		let text = String(value == null ? "" : value);
		if (/^[\s]*[=+@\-]/.test(text)) text = "'" + text;
		return `"${text.replace(/"/g, '""')}"`;
	};
	const rows = [headers];
	savedInvoiceRecords.forEach(record => {
		const type = record.type === "purchase" ? "purchase_tax" : (record.type || "sales");
		const invoiceNumber = record.invoiceDisplayNo || formatExportInvoiceNumber(type, record.date, record.invoiceNo);
		const customer = record.customer || {};
		const items = Array.isArray(record.items) && record.items.length ? record.items : [{ desc: "", qty: "", price: "" }];
		const paymentSummary = (record.payments || []).map(payment => [payment.mode, payment.ref, payment.amount].filter(Boolean).join(" ")).join(" | ");
		items.forEach((item, index) => {
			const qty = Number(item.qty) || 0;
			const price = Number(item.price) || 0;
			const lineTotal = qty * price;
			rows.push([
				SAVED_INVOICE_TYPES[type] || SAVED_INVOICE_TYPES.sales,
				invoiceNumber,
				record.date || "",
				customer.name || "",
				customer.email || "",
				customer.address || "",
				customer.phone || "",
				customer.trn || "",
				item.desc || "",
				item.qty == null ? "" : item.qty,
				item.price == null ? "" : item.price,
				record.vatRate == null ? 5 : record.vatRate,
				lineTotal.toFixed(2),
				index === 0 ? (record.grandTotal || 0) : "",
				index === 0 ? paymentSummary : ""
			]);
		});
	});
	const csv = "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
	const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `ATI-Saved-Invoices-${new Date().toISOString().slice(0, 10)}.csv`;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatExportInvoiceNumber(type, date, number) {
	if (type === "purchase") type = "purchase_tax";
	const parts = (date || new Date().toISOString().slice(0, 10)).split("-");
	const year = parts[0] || String(new Date().getFullYear());
	const day = parts[2] || "01";
	const month = parts[1] || "01";
	const dayMonth = `${day}${month}`;
	const sequence = parseInt(number, 10) || 1;
	const prefixes = { sales: "STI", purchase_tax: "PI", purchase_non_vat: "PU", commercial: "CI", consignment: "CSI", proforma: "PFI", credit: "CN" };
	const prefix = prefixes[type] || prefixes.sales;
	return `${prefix}-${year}-${dayMonth}-${String(sequence).padStart(6, "0")}`;
}
