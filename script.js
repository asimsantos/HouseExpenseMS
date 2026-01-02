// Expense Tracker Application Script
// This script powers the multi‑page household expense tracker. It manages state,
// renders views, handles filters and sorting, and coordinates handovers and history.

// Define members, categories and payment methods.  Updated to include Ashmi
// instead of Asmi and to use a new label "Responsible" for splitting expenses.
const members = ['Asim', 'Appy', 'Chire', 'Priyash', 'Pratikshya', 'Ashmi'];
const categories = ['Groceries', 'Bills/Utilities', 'Entertainment', 'Dining Out', 'Transport', 'Miscellaneous'];
const paymentMethods = ['Cash', 'Card'];

// Configure Supabase connection. Instead of hard‑coding your credentials here,
// we defer initialization until runtime. In production (e.g. on Vercel), the
// environment variables SUPABASE_URL and SUPABASE_ANON_KEY are stored
// securely and exposed via a serverless API route (`/api/env`). The
// `initSupabase()` function below fetches those values and initializes the
// Supabase client. For local development you can set `window.SUPABASE_URL`
// and `window.SUPABASE_ANON_KEY` in a separate script to override the
// default placeholders.

let supa = null;

// Fetch environment variables from the `/api/env` endpoint (Vercel serverless
// function) and initialize the Supabase client. If the fetch fails or
// environment variables are not available, fall back to globals on `window`.
async function initSupabase() {
    // If supa has already been initialized, do nothing
    if (supa) return;
    let url = null;
    let key = null;
    try {
        // Attempt to fetch from the serverless endpoint. This endpoint should
        // return JSON with `supabaseUrl` and `supabaseAnonKey` fields. When
        // deployed on Vercel, environment variables configured in the project
        // settings will be injected into this function. See api/env.js.
        const resp = await fetch('/api/env');
        if (resp.ok) {
            const json = await resp.json();
            url = json.supabaseUrl || null;
            key = json.supabaseAnonKey || null;
        }
    } catch (err) {
        console.warn('Could not fetch Supabase credentials from /api/env:', err);
    }
    // Fall back to global variables if fetch failed or returned nothing
    if (!url) url = typeof window !== 'undefined' && window.SUPABASE_URL ? window.SUPABASE_URL : 'YOUR_SUPABASE_URL';
    if (!key) key = typeof window !== 'undefined' && window.SUPABASE_ANON_KEY ? window.SUPABASE_ANON_KEY : 'YOUR_SUPABASE_ANON_KEY';
    // Initialize the Supabase client using the CDN `supabase` global.
    supa = supabase.createClient(url, key);
}

// In‑memory arrays for current expenses and past handovers. These will be
// populated from Supabase on page load.
let expenses = [];
let handovers = [];

// Archived expenses grouped by handover_id.  Each key is a handover UUID and
// the value is an array of expenses belonging to that handover.  This is
// populated in loadData() from Supabase.
let archivedExpensesByHandover = {};

// Load expenses and handovers from the remote database. This function
// populates the `expenses` and `handovers` arrays and should be called
// once on application start.
async function loadData() {
    // Ensure Supabase client is initialized before making queries.
    await initSupabase();
    // Fetch active expenses
    const { data: expData, error: expErr } = await supa
        .from('expenses')
        // Load only active expenses (where handover_id IS NULL)
        .select('*')
        .is('handover_id', null)
        .order('date', { ascending: true });
    if (expErr) {
        console.error('Error loading expenses:', expErr);
        expenses = [];
    } else {
        expenses = expData || [];
    }
    // Fetch handovers
    const { data: hoData, error: hoErr } = await supa
        .from('handovers')
        .select('*')
        .order('start_date', { ascending: true });
    if (hoErr) {
        console.error('Error loading handovers:', hoErr);
        handovers = [];
    } else {
        // Normalize handover objects so the code can refer to `.start` and `.end` properties.
        // When loading from Supabase, the columns are named `start_date` and `end_date`.
        handovers = (hoData || []).map(ho => {
            return {
                ...ho,
                start: ho.start || ho.start_date,
                end: ho.end || ho.end_date
            };
        });
    }

    // Fetch archived expenses (those belonging to past handovers) and group them
    const { data: archivedData, error: archErr } = await supa
        .from('expenses')
        .select('*')
        .not('handover_id', 'is', null)
        .order('date', { ascending: true });
    if (archErr) {
        console.error('Error loading archived expenses:', archErr);
        archivedExpensesByHandover = {};
    } else {
        archivedExpensesByHandover = {};
        (archivedData || []).forEach(exp => {
            const hid = exp.handover_id;
            if (!archivedExpensesByHandover[hid]) archivedExpensesByHandover[hid] = [];
            archivedExpensesByHandover[hid].push(exp);
        });
    }
}

// NOTE: The previous localStorage persistence functions (saveExpenses, saveHandovers)
// are no longer used because data is stored remotely.

// Populate select elements with options.  If includeAll is true, add an "All"
// option that represents splitting among all members.  This is used for the
// Responsible multi‑select.
function populateSelect(selectId, options, includeAll = false) {
    const select = document.getElementById(selectId);
    select.innerHTML = '';
    if (includeAll) {
        const opt = document.createElement('option');
        opt.value = 'All';
        opt.textContent = 'All';
        select.appendChild(opt);
    }
    options.forEach(optVal => {
        const opt = document.createElement('option');
        opt.value = optVal;
        opt.textContent = optVal;
        select.appendChild(opt);
    });
}

// Compute summary for a list of expenses.  Returns an object keyed by member
// name with { paid, share }.  Net is computed by caller as share - paid.
function computeSummaryFromList(list) {
    const summary = {};
    members.forEach(m => {
        summary[m] = { paid: 0, share: 0 };
    });
    list.forEach(exp => {
        const amount = parseFloat(exp.amount);
        // Add to payer's paid total
        if (summary[exp.payer]) {
            summary[exp.payer].paid += amount;
        }
        // Determine responsible list: handle legacy property names.
        // Older saved expenses may have a `beneficiaries` field instead of
        // `responsible`.  Pull whichever exists and default to an empty array.
        const resp = exp.responsible || exp.beneficiaries || [];
        let respList;
        // If All is selected, split among all members
        if (resp.includes('All')) {
            respList = [...members];
        } else {
            respList = resp;
        }
        const share = amount / (respList.length || 1);
        respList.forEach(name => {
            if (summary[name]) {
                summary[name].share += share;
            }
        });
    });
    return summary;
}

// Compute category totals for chart.  When person is 'All' we sum the full
// amounts, otherwise we sum the person's shares for each category.
function computeCategoryTotals(person) {
    const totals = {};
    categories.forEach(cat => (totals[cat] = 0));
    expenses.forEach(exp => {
        const amount = parseFloat(exp.amount);
        const category = exp.category;
        // Determine responsible list (handle legacy beneficiaries)
        const resp = exp.responsible || exp.beneficiaries || [];
        let respList;
        if (resp.includes('All')) {
            respList = [...members];
        } else {
            respList = resp;
        }
        const share = amount / (respList.length || 1);
        if (person === 'All') {
            totals[category] += amount;
        } else if (respList.includes(person)) {
            totals[category] += share;
        }
    });
    return totals;
}

// -----------------------------
// Additional helper functions
// -----------------------------

// Format a date string (YYYY-MM-DD) into "DD MMM YYYY" (e.g., 12 DEC 2025).
function formatDateDisplay(dateStr) {
    const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const [year, month, day] = dateStr.split('-');
    return `${day} ${months[parseInt(month, 10) - 1]} ${year}`;
}

// Compute and display the dashboard period (from last handover end or earliest
// current expense to the latest current expense) and total amount spent.  If
// there are no current expenses, a message will be shown instead.
function renderDashboardInfo() {
    const infoDiv = document.getElementById('dashboard-info');
    if (!infoDiv) return;
    if (!expenses || expenses.length === 0) {
        infoDiv.textContent = 'No expenses yet.';
        return;
    }
    // Determine period start: if there are past handovers, use the last handover end; else use earliest expense date.
    let start;
    if (handovers && handovers.length > 0) {
        start = handovers[handovers.length - 1].end;
    } else {
        start = expenses.reduce((min, exp) => (exp.date < min ? exp.date : min), expenses[0].date);
    }
    // Determine period end: latest expense date
    const end = expenses.reduce((max, exp) => (exp.date > max ? exp.date : max), expenses[0].date);
    // Compute total amount spent in current period
    const total = expenses.reduce((sum, exp) => sum + parseFloat(exp.amount), 0);
    const startDisplay = formatDateDisplay(start);
    const endDisplay = formatDateDisplay(end);
    infoDiv.innerHTML = `<strong>Period:</strong> ${startDisplay} – ${endDisplay}<br><strong>Total spent:</strong> $${total.toFixed(2)}`;
}

// Populate a container with checkboxes for responsible selection.  The
// `containerId` is the ID of the DOM element that will hold the checkboxes.  The
// optional `selected` array specifies which names should be checked on load;
// defaults to ['All'].
function populateResponsibleCheckboxes(containerId, selected = ['All']) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    // Helper to create a checkbox with label
    function createCheckbox(value, label) {
        const wrapper = document.createElement('div');
        wrapper.className = 'form-check me-2';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'form-check-input';
        input.id = `${containerId}-${value}`;
        input.value = value;
        input.checked = selected.includes(value);
        const lbl = document.createElement('label');
        lbl.className = 'form-check-label';
        lbl.htmlFor = input.id;
        lbl.textContent = label;
        wrapper.appendChild(input);
        wrapper.appendChild(lbl);
        return { wrapper, input };
    }
    // 'All' option
    const { wrapper: allWrapper, input: allInput } = createCheckbox('All', 'All');
    container.appendChild(allWrapper);
    // Individual member options
    const individualInputs = [];
    members.forEach(name => {
        const { wrapper, input } = createCheckbox(name, name);
        container.appendChild(wrapper);
        individualInputs.push(input);
    });
    // Event rules: when 'All' is checked, uncheck others; when any individual is checked, uncheck 'All';
    // when no individuals are checked, re-check 'All'.
    allInput.addEventListener('change', () => {
        if (allInput.checked) {
            individualInputs.forEach(cb => cb.checked = false);
        }
    });
    individualInputs.forEach(cb => {
        cb.addEventListener('change', () => {
            if (cb.checked) {
                allInput.checked = false;
            } else {
                const anyChecked = individualInputs.some(other => other.checked);
                if (!anyChecked) {
                    allInput.checked = true;
                }
            }
        });
    });
}

// Compute category totals from an arbitrary list of expenses.  Works similarly
// to computeCategoryTotals but operates on an arbitrary list of expenses instead of
// the global `expenses` array.
function computeCategoryTotalsFromList(list, person) {
    const totals = {};
    categories.forEach(cat => (totals[cat] = 0));
    list.forEach(exp => {
        const amount = parseFloat(exp.amount);
        const category = exp.category;
        const resp = exp.responsible || exp.beneficiaries || [];
        let respList;
        if (resp.includes('All')) {
            respList = [...members];
        } else {
            respList = resp;
        }
        const share = amount / (respList.length || 1);
        if (person === 'All') {
            totals[category] += amount;
        } else if (respList.includes(person)) {
            totals[category] += share;
        }
    });
    return totals;
}

// Render a custom history report.  Based on the currently selected start and end
// dates in the history filters, it gathers expenses from past handovers in that
// date range, computes a summary and total, and populates the custom report
// section with a table and pie chart.
function renderHistoryReport() {
    const startDate = document.getElementById('history-start').value;
    const endDate = document.getElementById('history-end').value;
    const reportDiv = document.getElementById('history-report');
    const infoDiv = document.getElementById('history-report-info');
    const tbody = document.getElementById('history-report-body');
    const chartSelect = document.getElementById('history-chart-person');
    if (!reportDiv || !infoDiv || !tbody || !chartSelect) return;
    // Collect expenses from handovers within the specified date range.  We
    // retrieve archived expenses from the `archivedExpensesByHandover`
    // structure instead of relying on a nonexistent `handover.expenses`
    // property. Each archived expense has a `handover_id` linking it to its
    // handover record.
    let selectedExpenses = [];
    handovers.forEach(handover => {
        const hoExps = archivedExpensesByHandover[handover.id] || [];
        hoExps.forEach(exp => {
            if (startDate && exp.date < startDate) return;
            if (endDate && exp.date > endDate) return;
            selectedExpenses.push(exp);
        });
    });
    if (selectedExpenses.length === 0) {
        // Hide report if no data
        reportDiv.classList.add('d-none');
        return;
    }
    // Compute summary and total
    const summary = computeSummaryFromList(selectedExpenses);
    const total = selectedExpenses.reduce((sum, exp) => sum + parseFloat(exp.amount), 0);
    // Determine actual start/end from selected expenses
    const actualStart = selectedExpenses.reduce((min, exp) => exp.date < min ? exp.date : min, selectedExpenses[0].date);
    const actualEnd = selectedExpenses.reduce((max, exp) => exp.date > max ? exp.date : max, selectedExpenses[0].date);
    infoDiv.innerHTML = `<strong>Period:</strong> ${formatDateDisplay(actualStart)} – ${formatDateDisplay(actualEnd)}<br><strong>Total spent:</strong> $${total.toFixed(2)}`;
    tbody.innerHTML = '';
    members.forEach(name => {
        const s = summary[name] || { paid: 0, share: 0 };
        const net = s.share - s.paid;
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${name}</td><td>$${s.paid.toFixed(2)}</td><td>$${s.share.toFixed(2)}</td><td>$${net.toFixed(2)}</td>`;
        tbody.appendChild(tr);
    });
    // Populate chart person select only once
    if (chartSelect.options.length === 0) {
        const allOpt = document.createElement('option');
        allOpt.value = 'All';
        allOpt.textContent = 'All';
        chartSelect.appendChild(allOpt);
        members.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            chartSelect.appendChild(opt);
        });
        chartSelect.addEventListener('change', () => {
            renderHistoryCategoryChart(selectedExpenses, chartSelect.value);
        });
    }
    // Set default selection to All and render chart
    chartSelect.value = 'All';
    renderHistoryCategoryChart(selectedExpenses, 'All');
    reportDiv.classList.remove('d-none');
}

// Render a category breakdown chart for the history report.
function renderHistoryCategoryChart(list, person) {
    const totals = computeCategoryTotalsFromList(list, person);
    const labels = Object.keys(totals);
    const data = Object.values(totals);
    const colors = labels.map((_, i) => {
        const hue = (i * 45) % 360;
        return `hsl(${hue}, 70%, 60%)`;
    });
    if (historyCategoryChart) {
        historyCategoryChart.data.labels = labels;
        historyCategoryChart.data.datasets[0].data = data;
        historyCategoryChart.data.datasets[0].backgroundColor = colors;
        historyCategoryChart.options.plugins.title.text = person === 'All' ? 'Overall Category Spend' : `${person}'s Category Share`;
        historyCategoryChart.update();
    } else {
        const ctx = document.getElementById('historyCategoryChart');
        historyCategoryChart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: labels,
                datasets: [{ data: data, backgroundColor: colors }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { position: 'bottom' },
                    title: { display: true, text: person === 'All' ? 'Overall Category Spend' : `${person}'s Category Share` }
                }
            }
        });
    }
}

// Compute settlement transactions based on a summary object.  This implements a
// simple settlement scheme: all people who owe (net > 0) pay their owed
// amount to the highest receiver (largest negative net).  The highest receiver
// then pays out to any other receivers their owed amounts.  Returns an array
// of strings describing the transactions.
function computeSettlement(summary) {
    const debtors = [];
    const receivers = [];
    members.forEach(name => {
        const s = summary[name] || { paid: 0, share: 0 };
        const net = s.share - s.paid;
        if (net > 0.01) {
            debtors.push({ name, amount: net });
        } else if (net < -0.01) {
            receivers.push({ name, amount: -net });
        }
    });
    const transactions = [];
    if (debtors.length === 0 || receivers.length === 0) return transactions;
    // Highest receiver is the one owed the most
    receivers.sort((a, b) => b.amount - a.amount);
    const highest = receivers[0];
    // Debtors pay the highest receiver
    debtors.forEach(d => {
        transactions.push(`${d.name} to ${highest.name}: $${d.amount.toFixed(2)}`);
    });
    // Highest receiver pays out the owed amounts to other receivers (excluding himself)
    receivers.slice(1).forEach(rec => {
        transactions.push(`${highest.name} to ${rec.name}: $${rec.amount.toFixed(2)}`);
    });
    return transactions;
}

// Open the edit modal for the expense at the specified index.  Prefills the
// form fields with the existing expense data and shows the modal.
function openEditModal(index) {
    currentEditIndex = index;
    const exp = expenses[index];
    // Prefill simple inputs
    document.getElementById('edit-date').value = exp.date;
    document.getElementById('edit-title').value = exp.title;
    document.getElementById('edit-description').value = exp.description || '';
    document.getElementById('edit-amount').value = parseFloat(exp.amount).toFixed(2);
    // Populate selects and set value
    populateSelect('edit-category', categories);
    populateSelect('edit-payment', paymentMethods);
    populateSelect('edit-payer', members);
    document.getElementById('edit-category').value = exp.category;
    document.getElementById('edit-payment').value = exp.payment;
    document.getElementById('edit-payer').value = exp.payer;
    // Populate responsible checkboxes
    const respList = exp.responsible || exp.beneficiaries || [];
    const selected = respList.includes('All') || respList.length === 0 ? ['All'] : respList;
    populateResponsibleCheckboxes('edit-responsible', selected);
    // Show modal using Bootstrap JS API
    const modalEl = document.getElementById('edit-modal');
    const modal = new bootstrap.Modal(modalEl);
    modal.show();
}

// Save changes made in the edit modal back to the expenses list
async function saveEdit() {
    if (currentEditIndex === null) return;
    const idx = currentEditIndex;
    // Retrieve values from the modal
    const date = document.getElementById('edit-date').value;
    const title = document.getElementById('edit-title').value;
    const description = document.getElementById('edit-description').value;
    const amount = document.getElementById('edit-amount').value;
    const category = document.getElementById('edit-category').value;
    const payment = document.getElementById('edit-payment').value;
    const payer = document.getElementById('edit-payer').value;
    const selected = Array.from(document.querySelectorAll('#edit-responsible input[type=checkbox]:checked')).map(cb => cb.value);
    if (selected.length === 0) {
        alert('Please select at least one responsible person');
        return;
    }
    // Grab the existing expense record to get its ID
    const existing = expenses[idx];
    const updated = {
        date,
        title,
        description,
        amount,
        category,
        payment,
        payer,
        responsible: selected
    };
    try {
        // Perform update in Supabase using the record's ID
        const { error } = await supa.from('expenses').update(updated).eq('id', existing.id);
        if (error) {
            console.error('Error updating expense:', error);
            alert('Failed to update expense');
            return;
        }
        // Replace the record in the local array
        expenses[idx] = { ...existing, ...updated };
        // Refresh views
        renderSummary();
        renderExpensesList();
        const person = document.getElementById('chart-person-select').value || 'All';
        renderCategoryChart(person);
        // Hide modal
        const modalEl = document.getElementById('edit-modal');
        const modal = bootstrap.Modal.getInstance(modalEl);
        modal.hide();
        currentEditIndex = null;
    } catch (err) {
        console.error('Unexpected error updating expense:', err);
        alert('An unexpected error occurred while updating expense');
    }
}

// Delete an expense by index after confirmation
async function deleteExpense(index) {
    if (!confirm('Are you sure you want to delete this expense?')) return;
    const exp = expenses[index];
    try {
        const { error } = await supa.from('expenses').delete().eq('id', exp.id);
        if (error) {
            console.error('Error deleting expense:', error);
            alert('Failed to delete expense');
            return;
        }
        expenses.splice(index, 1);
        renderSummary();
        renderExpensesList();
        const person = document.getElementById('chart-person-select').value || 'All';
        renderCategoryChart(person);
    } catch (err) {
        console.error('Unexpected error deleting expense:', err);
        alert('An unexpected error occurred while deleting expense');
    }
}

// Render summary table for the dashboard using current expenses.
function renderSummary() {
    const summary = computeSummaryFromList(expenses);
    const tbody = document.getElementById('summary-body');
    tbody.innerHTML = '';
    members.forEach(name => {
        const s = summary[name];
        const net = s.share - s.paid;
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${name}</td>` +
            `<td>$${s.paid.toFixed(2)}</td>` +
            `<td>$${s.share.toFixed(2)}</td>` +
            `<td>$${net.toFixed(2)}</td>`;
        tbody.appendChild(tr);
    });

    // Update dashboard period and total information
    if (typeof renderDashboardInfo === 'function') {
        renderDashboardInfo();
    }
}

// Global chart instance for category breakdown.  We reuse the same chart
// instance and update its data to avoid re‑creating canvases.
let categoryChart = null;

// Separate chart instance for the history custom report
let historyCategoryChart = null;
// Track the index of the expense being edited in the edit modal
let currentEditIndex = null;

function renderCategoryChart(person) {
    const totals = computeCategoryTotals(person);
    const labels = Object.keys(totals);
    const data = Object.values(totals);
    const colors = labels.map((_, i) => {
        // Generate a palette of pastel colors
        const hue = (i * 45) % 360;
        return `hsl(${hue}, 70%, 60%)`;
    });
    if (categoryChart) {
        categoryChart.data.labels = labels;
        categoryChart.data.datasets[0].data = data;
        categoryChart.data.datasets[0].backgroundColor = colors;
        categoryChart.options.plugins.title.text = person === 'All' ? 'Overall Category Spend' : `${person}'s Category Share`;
        categoryChart.update();
    } else {
        const ctx = document.getElementById('categoryChart');
        categoryChart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: colors
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        position: 'bottom'
                    },
                    title: {
                        display: true,
                        text: person === 'All' ? 'Overall Category Spend' : `${person}'s Category Share`
                    }
                }
            }
        });
    }
}

// Render expense list table based on filters and sorting.
function renderExpensesList() {
    // Get filter values
    const payerFilter = document.getElementById('filter-payer').value;
    const categoryFilter = document.getElementById('filter-category').value;
    const responsibleFilter = document.getElementById('filter-responsible').value;
    const sortOrder = document.getElementById('sort-date').value;
    // Apply filters
    let filtered = expenses.filter(exp => {
        const matchesPayer = !payerFilter || exp.payer === payerFilter;
        const matchesCategory = !categoryFilter || exp.category === categoryFilter;
        const respList = exp.responsible || exp.beneficiaries || [];
        const matchesResponsible = !responsibleFilter ||
            (respList.includes('All') ? members.includes(responsibleFilter) : respList.includes(responsibleFilter));
        return matchesPayer && matchesCategory && matchesResponsible;
    });
    // Sort by date (descending or ascending).  Because HTML date input uses ISO strings (YYYY-MM-DD),
    // we can sort lexicographically; but we convert to Date for clarity.
    filtered.sort((a, b) => {
        const da = new Date(a.date);
        const db = new Date(b.date);
        return sortOrder === 'asc' ? da - db : db - da;
    });
    const tbody = document.getElementById('expenses-body');
    tbody.innerHTML = '';
    filtered.forEach(exp => {
        const tr = document.createElement('tr');
        const idx = expenses.indexOf(exp);
        tr.innerHTML = `
            <td>${exp.date}</td>
            <td>${exp.title}</td>
            <td>${exp.description || ''}</td>
            <td>$${parseFloat(exp.amount).toFixed(2)}</td>
            <td>${exp.category}</td>
            <td>${exp.payer}</td>
            <td>${(exp.responsible || exp.beneficiaries || []).join(', ')}</td>
            <td>${exp.payment}</td>
            <td>
                <button class="btn btn-sm btn-outline-secondary edit-btn" data-index="${idx}">Edit</button>
                <button class="btn btn-sm btn-outline-danger delete-btn" data-index="${idx}">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    // Attach event listeners for edit and delete buttons
    tbody.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            const index = parseInt(e.target.dataset.index);
            openEditModal(index);
        });
    });
    tbody.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            const index = parseInt(e.target.dataset.index);
            deleteExpense(index);
        });
    });
}

// Render history of handovers.  If date filters are provided, only show
// handovers whose range intersects the selected range.
function renderHistory() {
    const start = document.getElementById('history-start').value;
    const end = document.getElementById('history-end').value;
    const container = document.getElementById('history-content');
    container.innerHTML = '';
    if (handovers.length === 0) {
        container.innerHTML = '<p>No past handovers yet.</p>';
        return;
    }
    handovers.forEach((handover, idx) => {
        // If date filters are set, skip those outside the range.
        if (start && handover.end < start) return;
        if (end && handover.start > end) return;
        const card = document.createElement('div');
        card.className = 'accordion-item';
        const headerId = `handoverHeader${idx}`;
        const collapseId = `handoverCollapse${idx}`;
        let settlementHTML = '';
        if (handover.transactions && handover.transactions.length > 0) {
            settlementHTML = `<h6>Settlement</h6><ul>` + handover.transactions.map(t => `<li>${t}</li>`).join('') + `</ul><hr>`;
        }
        // Retrieve archived expenses for this handover from the grouped object
        const hoExps = archivedExpensesByHandover[handover.id] || [];
        const expensesRows = hoExps.map(exp => {
            const respList = (exp.responsible || exp.beneficiaries || []).join(', ');
            return `<tr><td>${exp.date}</td><td>${exp.title}</td><td>$${parseFloat(exp.amount).toFixed(2)}</td><td>${exp.category}</td><td>${exp.payer}</td><td>${respList}</td><td>${exp.payment}</td></tr>`;
        }).join('');
        card.innerHTML = `
            <h2 class="accordion-header" id="${headerId}">
                <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="false" aria-controls="${collapseId}">
                    Handover ${idx + 1}: ${handover.start} to ${handover.end}
                </button>
            </h2>
            <div id="${collapseId}" class="accordion-collapse collapse" aria-labelledby="${headerId}" data-bs-parent="#history-content">
                <div class="accordion-body">
                    ${generateSummaryTableHTML(handover.summary)}
                    ${settlementHTML}
                    <hr>
                    <h6>Expenses</h6>
                    <table class="table table-sm">
                        <thead class="table-light">
                            <tr>
                                <th>Date</th><th>Title</th><th>Amount</th><th>Category</th><th>Payer</th><th>Responsible</th><th>Payment</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${expensesRows}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        container.appendChild(card);
    });

    // After listing handovers, render a custom report based on the selected date range
    if (typeof renderHistoryReport === 'function') {
        renderHistoryReport();
    }
}

// Helper to generate a summary table's HTML from a summary object.
function generateSummaryTableHTML(summary) {
    let html = '<table class="table table-bordered"><thead class="table-light"><tr><th>Member</th><th>Paid</th><th>Share</th><th>Net</th></tr></thead><tbody>';
    members.forEach(name => {
        const s = summary[name] || { paid: 0, share: 0 };
        const net = s.share - s.paid;
        html += `<tr><td>${name}</td><td>$${s.paid.toFixed(2)}</td><td>$${s.share.toFixed(2)}</td><td>$${net.toFixed(2)}</td></tr>`;
    });
    html += '</tbody></table>';
    return html;
}

// Show the specified page and hide others.  Update nav link active state.
function showPage(page) {
    ['dashboard','expenses','history','handover'].forEach(id => {
        const section = document.getElementById(id);
        if (section) {
            if (id === page) {
                section.classList.remove('d-none');
            } else {
                section.classList.add('d-none');
            }
        }
    });
    // Update nav link active class
    document.querySelectorAll('.navbar .nav-link').forEach(link => {
        if (link.getAttribute('data-page') === page) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
    // When entering dashboard, update summary, chart and dashboard info
    if (page === 'dashboard') {
        renderSummary();
        const person = document.getElementById('chart-person-select').value || 'All';
        renderCategoryChart(person);
    }
    // When entering expenses page, refresh the list
    if (page === 'expenses') {
        renderExpensesList();
    }
    // When entering history, refresh history display and hide report
    if (page === 'history') {
        renderHistory();
        // Hide custom report on initial load
        const reportDiv = document.getElementById('history-report');
        if (reportDiv) reportDiv.classList.add('d-none');
    }
    // Reset handover summary when entering handover page
    if (page === 'handover') {
        document.getElementById('handover-summary').innerHTML = '';
        document.getElementById('confirm-handover').classList.add('d-none');
    }
}

// Add expense handler.  Validates responsible selection and pushes new entry.
async function addExpense(event) {
    event.preventDefault();
    const date = document.getElementById('date').value;
    const title = document.getElementById('title').value;
    const description = document.getElementById('description').value;
    const amount = document.getElementById('amount').value;
    const category = document.getElementById('category').value;
    const payment = document.getElementById('payment').value;
    const payer = document.getElementById('payer').value;
    // Get responsible selection from checkboxes
    const selected = Array.from(document.querySelectorAll('#responsible-options input[type=checkbox]:checked')).map(cb => cb.value);
    if (selected.length === 0) {
        alert('Please select at least one responsible person');
        return;
    }
    // Include handover_id as null to mark this expense as active (not yet handed over).
    const exp = { date, title, description, amount, category, payment, payer, responsible: selected, handover_id: null };
    try {
        // Insert into Supabase and get the created record back
        const { data, error } = await supa.from('expenses').insert([exp]).select();
        if (error) {
            console.error('Error adding expense:', error);
            alert('Failed to add expense');
            return;
        }
        // Append the returned record to the local array
        if (data && data.length > 0) {
            expenses.push(data[0]);
        }
        // Reset form fields and reset responsible checkboxes to default (All)
        document.getElementById('expense-form').reset();
        populateResponsibleCheckboxes('responsible-options', ['All']);
        // Refresh summary, list and chart
        renderSummary();
        renderExpensesList();
        const person = document.getElementById('chart-person-select').value || 'All';
        renderCategoryChart(person);
        alert('Expense added successfully!');
    } catch (err) {
        console.error('Unexpected error adding expense:', err);
        alert('An unexpected error occurred while adding expense');
    }
}

// Handle handover generation: compute summary for current expenses and show confirmation.
function generateHandover() {
    const date = document.getElementById('handover-date').value;
    if (!date) {
        alert('Please select a handover date');
        return;
    }
    if (expenses.length === 0) {
        alert('No expenses to handover');
        return;
    }
    // Determine start date: if there are previous handovers, use the last handover's end; otherwise use the earliest expense date.
    let startDate;
    if (handovers.length === 0) {
        startDate = expenses.reduce((min, exp) => (exp.date < min ? exp.date : min), expenses[0].date);
    } else {
        startDate = handovers[handovers.length - 1].end;
    }
    // Filter expenses within the new handover period.  If there is a previous
    // handover, we exclude any expense with a date equal to startDate (since
    // that date was covered by the previous period).  For the very first
    // handover (no prior handovers), we include the earliest expense date as
    // part of the period.  We also only include expenses up to (and
    // including) the chosen handover date.
    const includeStart = (handovers.length === 0);
    const selectedExpenses = expenses.filter(exp => {
        // Compare ISO date strings directly; they are lexicographically comparable.
        if (includeStart) {
            return exp.date >= startDate && exp.date <= date;
        } else {
            return exp.date > startDate && exp.date <= date;
        }
    });
    if (selectedExpenses.length === 0) {
        alert('No expenses to handover for the selected date range.');
        return;
    }
    // Compute summary, transactions and total using only the selected expenses.
    const summary = computeSummaryFromList(selectedExpenses);
    const summaryHTML = generateSummaryTableHTML(summary);
    const transactions = computeSettlement(summary);
    const total = selectedExpenses.reduce((sum, exp) => sum + parseFloat(exp.amount), 0);
    // Display summary, total and settlement details
    const summaryDiv = document.getElementById('handover-summary');
    const startDisp = formatDateDisplay(startDate);
    const endDisp = formatDateDisplay(date);
    let html = `<h5>Expenses Account (${startDisp} – ${endDisp})</h5>`;
    html += `<p><strong>Total:</strong> $${total.toFixed(2)}</p>`;
    html += summaryHTML;
    if (transactions && transactions.length > 0) {
        html += '<h6 class="mt-3">Settlement</h6><ul>' + transactions.map(t => `<li>${t}</li>`).join('') + '</ul>';
    }
    summaryDiv.innerHTML = html;
    // Show confirm button and store the selected expenses' IDs so we can update them later
    const confirmBtn = document.getElementById('confirm-handover');
    confirmBtn.classList.remove('d-none');
    confirmBtn.dataset.start = startDate;
    confirmBtn.dataset.end = date;
    confirmBtn.dataset.summary = JSON.stringify(summary);
    confirmBtn.dataset.transactions = JSON.stringify(transactions);
    confirmBtn.dataset.expenseIds = JSON.stringify(selectedExpenses.map(e => e.id));
}

// Confirm handover: move expenses to history, clear current, and save.
async function confirmHandover() {
    const start = this.dataset.start;
    const end = this.dataset.end;
    const summary = JSON.parse(this.dataset.summary);
    const transactions = JSON.parse(this.dataset.transactions || '[]');
    const expenseIds = JSON.parse(this.dataset.expenseIds || '[]');
    try {
        // Insert the handover summary into Supabase and retrieve the inserted row
        const insertObj = {
            start_date: start,
            end_date: end,
            summary: summary,
            transactions: transactions
        };
        const { data: hoInsertData, error: hoErr } = await supa.from('handovers').insert([insertObj]).select();
        if (hoErr) {
            console.error('Error inserting handover:', hoErr);
            alert('Failed to record handover');
            return;
        }
        const newHandover = hoInsertData && hoInsertData.length > 0 ? hoInsertData[0] : null;
        if (!newHandover) {
            alert('Failed to retrieve new handover');
            return;
        }
        // Update only the selected expenses to mark them as belonging to this handover
        for (const id of expenseIds) {
            const { error: updErr } = await supa.from('expenses').update({ handover_id: newHandover.id }).eq('id', id);
            if (updErr) {
                console.error('Error updating expense during handover:', updErr);
            }
        }
        // Remove the handed over expenses from the local active list
        expenses = expenses.filter(exp => !expenseIds.includes(exp.id));
        // Reload archived data from DB to update history and local arrays
        await loadData();
        // Hide confirm button
        document.getElementById('confirm-handover').classList.add('d-none');
        // Refresh views
        renderSummary();
        renderExpensesList();
        renderHistory();
        // Update dashboard period and total
        renderDashboardInfo();
        // Clear summary display
        document.getElementById('handover-summary').innerHTML = '';
        alert('Handover completed. The period has been moved to history.');
    } catch (err) {
        console.error('Unexpected error during handover:', err);
        alert('An unexpected error occurred while completing the handover');
    }
}

// Initialize page
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize Supabase (fetch env variables) and load remote data
    await initSupabase();
    await loadData();

    // Populate selects for forms and filters
    populateSelect('category', categories);
    populateSelect('payment', paymentMethods);
    populateSelect('payer', members);
    // Populate responsible checkboxes with All selected by default
    populateResponsibleCheckboxes('responsible-options', ['All']);
    // Populate filters
    const payerFilter = document.getElementById('filter-payer');
    members.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        payerFilter.appendChild(opt);
    });
    const categoryFilter = document.getElementById('filter-category');
    categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        categoryFilter.appendChild(opt);
    });
    const responsibleFilter = document.getElementById('filter-responsible');
    members.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        responsibleFilter.appendChild(opt);
    });
    // Populate chart person select (for dashboard)
    const chartSelect = document.getElementById('chart-person-select');
    const allOptSel = document.createElement('option');
    allOptSel.value = 'All';
    allOptSel.textContent = 'All';
    chartSelect.appendChild(allOptSel);
    members.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        chartSelect.appendChild(opt);
    });
    chartSelect.addEventListener('change', () => {
        const person = chartSelect.value;
        renderCategoryChart(person);
    });
    // Navigation click handlers
    document.querySelectorAll('.navbar .nav-link').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            const page = link.getAttribute('data-page');
            showPage(page);
        });
    });
    // Form submission
    document.getElementById('expense-form').addEventListener('submit', addExpense);
    // Filter change handlers
    document.getElementById('filter-payer').addEventListener('change', renderExpensesList);
    document.getElementById('filter-category').addEventListener('change', renderExpensesList);
    document.getElementById('filter-responsible').addEventListener('change', renderExpensesList);
    document.getElementById('sort-date').addEventListener('change', renderExpensesList);
    // History filter button
    document.getElementById('history-filter-btn').addEventListener('click', () => {
        renderHistory();
        renderHistoryReport();
    });
    // Handover buttons
    document.getElementById('generate-handover').addEventListener('click', generateHandover);
    document.getElementById('confirm-handover').addEventListener('click', confirmHandover);

    // Edit modal save button
    document.getElementById('edit-save').addEventListener('click', saveEdit);
    // Initial render after data load
    renderSummary();
    renderDashboardInfo();
    // Set default chart to overall
    chartSelect.value = 'All';
    renderCategoryChart('All');
});