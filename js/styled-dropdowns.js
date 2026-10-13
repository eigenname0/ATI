let styledDropdownId = 0;

function syncStyledDropdown(select) {
	const wrapper = select && select._styledDropdown;
	if (!wrapper) return;
	const button = wrapper.querySelector(".styledDropdownButton");
	const options = Array.from(select.options);
	const selected = options[select.selectedIndex];
	button.querySelector(".styledDropdownValue").textContent = selected ? selected.textContent : "Select an option";
	wrapper.querySelectorAll("[role=option]").forEach((item, index) => {
		const isSelected = options[index] === selected;
		item.classList.toggle("selected", isSelected);
		item.setAttribute("aria-selected", String(isSelected));
	});
}

function closeStyledDropdown(wrapper, returnFocus) {
	if (!wrapper) return;
	wrapper.classList.remove("open");
	const button = wrapper.querySelector(".styledDropdownButton");
	button.setAttribute("aria-expanded", "false");
	if (returnFocus) button.focus();
}

function enhanceStyledDropdown(select) {
	if (!select || select._styledDropdown || !select.options.length) return;
	const wrapper = document.createElement("div");
	wrapper.className = "styledDropdown";
	const button = document.createElement("button");
	button.className = "styledDropdownButton";
	button.type = "button";
	button.setAttribute("aria-haspopup", "listbox");
	button.setAttribute("aria-expanded", "false");
	button.setAttribute("aria-label", select.getAttribute("aria-label") || (select.id === "invoiceType" ? "Invoice type" : "Payment method"));
	button.innerHTML = '<span class="styledDropdownValue"></span><span class="styledDropdownChevron" aria-hidden="true"></span>';
	const menu = document.createElement("div");
	menu.className = "styledDropdownMenu";
	menu.id = "styled-dropdown-" + (++styledDropdownId);
	menu.setAttribute("role", "listbox");
	button.setAttribute("aria-controls", menu.id);
	Array.from(select.options).forEach((option, index) => {
		const item = document.createElement("button");
		item.type = "button";
		item.className = "styledDropdownOption";
		item.setAttribute("role", "option");
		item.setAttribute("aria-selected", "false");
		item.textContent = option.textContent;
		item.addEventListener("click", () => {
			select.selectedIndex = index;
			syncStyledDropdown(select);
			select.dispatchEvent(new Event("change", { bubbles: true }));
			closeStyledDropdown(wrapper, true);
		});
		item.addEventListener("keydown", (event) => {
			const items = Array.from(menu.querySelectorAll("[role=option]"));
			const current = items.indexOf(item);
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				items[(current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
			} else if (event.key === "Escape") {
				event.preventDefault();
				closeStyledDropdown(wrapper, true);
			} else if (event.key === "Tab") closeStyledDropdown(wrapper, false);
		});
		menu.appendChild(item);
	});
	select.classList.add("styledDropdownNative");
	select.setAttribute("aria-hidden", "true");
	select.tabIndex = -1;
	select.insertAdjacentElement("afterend", wrapper);
	wrapper.append(button, menu);
	select._styledDropdown = wrapper;
	button.addEventListener("click", () => {
		const opening = !wrapper.classList.contains("open");
		document.querySelectorAll(".styledDropdown.open").forEach(other => closeStyledDropdown(other, false));
		wrapper.classList.toggle("open", opening);
		button.setAttribute("aria-expanded", String(opening));
		if (opening) {
			const selected = menu.querySelector('[aria-selected="true"]') || menu.querySelector("[role=option]");
			if (selected) selected.focus();
		}
	});
	button.addEventListener("keydown", (event) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			button.click();
		}
	});
	select.addEventListener("change", () => syncStyledDropdown(select));
	syncStyledDropdown(select);
}

function initStyledDropdowns(root) {
	const scope = root || document;
	scope.querySelectorAll(root ? "select" : ".editor select").forEach(enhanceStyledDropdown);
	if (!document._styledDropdownOutsideHandler) {
		document.addEventListener("click", (event) => {
			if (!event.target.closest(".styledDropdown")) {
				document.querySelectorAll(".styledDropdown.open").forEach(wrapper => closeStyledDropdown(wrapper, false));
			}
		});
		document._styledDropdownOutsideHandler = true;
	}
}
