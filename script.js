// Expense Tracker Application Script
// This script powers the multi‑page household expense tracker. It manages state,
// renders views, handles filters and sorting, and coordinates handovers and history.

// Define members, categories and payment methods.  Updated to include Ashmi
// instead of Asmi and to use a new label "Responsible" for splitting expenses.
const members = ['Asim', 'Appy', 'Chire', 'Priyash', 'Pratikshya', 'Ashmi'];
const categories = ['Groceries', 'Bills/Utilities', 'Entertainment', 'Dining Out', 'Transport', 'Miscellaneous'];
const paymentMethods = ['Cash', 'Card'];

// Load persisted data from localStorage.  We store current period expenses in
// `expenses` and past handovers in `handovers`. Each handover is an object
// { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', expenses: [ ... ], summary: {...} }.
let expenses = JSON.parse(localStorage.getItem('expenses') || '[]');
let handovers = JSON.parse(localStorage.getItem('handovers') || '[]');

// Persist changes to localStorage.
function saveExpenses() {
    localStorage.setItem('expenses', JSON.stringify(expenses));
}

function saveHandovers() {
    localStorage.setItem('handovers', JSON.stringify(handovers));
}

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
}

// Global chart instance for category breakdown.  We reuse the same chart
// instance and update its data to avoid re‑creating canvases.
let categoryChart = null;

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
        tr.innerHTML = `
            <td>${exp.date}</td>
            <td>${exp.title}</td>
            <td>${exp.description || ''}</td>
            <td>$${parseFloat(exp.amount).toFixed(2)}</td>
            <td>${exp.category}</td>
            <td>${exp.payer}</td>
            <td>${(exp.responsible || exp.beneficiaries || []).join(', ')}</td>
            <td>${exp.payment}</td>
        `;
        tbody.appendChild(tr);
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
        card.innerHTML = `
            <h2 class="accordion-header" id="${headerId}">
                <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}" aria-expanded="false" aria-controls="${collapseId}">
                    Handover ${idx + 1}: ${handover.start} to ${handover.end}
                </button>
            </h2>
            <div id="${collapseId}" class="accordion-collapse collapse" aria-labelledby="${headerId}" data-bs-parent="#history-content">
                <div class="accordion-body">
                    ${generateSummaryTableHTML(handover.summary)}
                    <hr>
                    <h6>Expenses</h6>
                    <table class="table table-sm">
                        <thead class="table-light">
                            <tr>
                                <th>Date</th><th>Title</th><th>Amount</th><th>Category</th><th>Payer</th><th>Responsible</th><th>Payment</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${handover.expenses.map(exp => {
                                const respList = (exp.responsible || exp.beneficiaries || []).join(', ');
                                return `<tr><td>${exp.date}</td><td>${exp.title}</td><td>$${parseFloat(exp.amount).toFixed(2)}</td><td>${exp.category}</td><td>${exp.payer}</td><td>${respList}</td><td>${exp.payment}</td></tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
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
    ['dashboard','entry','list','history','handover'].forEach(id => {
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
    // When entering dashboard, update summary and chart
    if (page === 'dashboard') {
        renderSummary();
        const person = document.getElementById('chart-person-select').value || 'All';
        renderCategoryChart(person);
    }
    // When entering list, ensure table and filters refresh
    if (page === 'list') {
        renderExpensesList();
    }
    // When entering history, refresh history display
    if (page === 'history') {
        renderHistory();
    }
    // Reset handover summary when entering handover page
    if (page === 'handover') {
        document.getElementById('handover-summary').innerHTML = '';
        document.getElementById('confirm-handover').classList.add('d-none');
    }
}

// Add expense handler.  Validates responsible selection and pushes new entry.
function addExpense(event) {
    event.preventDefault();
    const date = document.getElementById('date').value;
    const title = document.getElementById('title').value;
    const description = document.getElementById('description').value;
    const amount = document.getElementById('amount').value;
    const category = document.getElementById('category').value;
    const payment = document.getElementById('payment').value;
    const payer = document.getElementById('payer').value;
    const responsibleSelect = document.getElementById('responsible');
    const selected = Array.from(responsibleSelect.selectedOptions).map(opt => opt.value);
    if (selected.length === 0) {
        alert('Please select at least one responsible person');
        return;
    }
    const exp = {
        date,
        title,
        description,
        amount,
        category,
        payment,
        payer,
        responsible: selected
    };
    expenses.push(exp);
    saveExpenses();
    // Reset form
    document.getElementById('expense-form').reset();
    // Refresh summary and lists
    renderSummary();
    renderExpensesList();
    // Update chart options if on dashboard
    const person = document.getElementById('chart-person-select').value || 'All';
    renderCategoryChart(person);
    alert('Expense added successfully!');
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
    // Determine start date as earliest expense date or last handover end
    let startDate;
    if (handovers.length === 0) {
        startDate = expenses.reduce((min, exp) => (exp.date < min ? exp.date : min), expenses[0].date);
    } else {
        // Last handover end is the start for new period
        startDate = handovers[handovers.length - 1].end;
    }
    // Compute summary for current expenses list
    const summary = computeSummaryFromList(expenses);
    const summaryHTML = generateSummaryTableHTML(summary);
    // Display summary and show confirm button
    const summaryDiv = document.getElementById('handover-summary');
    summaryDiv.innerHTML = `<h5>Summary for ${startDate} to ${date}</h5>` + summaryHTML;
    const confirmBtn = document.getElementById('confirm-handover');
    confirmBtn.classList.remove('d-none');
    // Store the generated summary and dates temporarily on the confirm button
    confirmBtn.dataset.start = startDate;
    confirmBtn.dataset.end = date;
    confirmBtn.dataset.summary = JSON.stringify(summary);
}

// Confirm handover: move expenses to history, clear current, and save.
function confirmHandover() {
    const start = this.dataset.start;
    const end = this.dataset.end;
    const summary = JSON.parse(this.dataset.summary);
    // Clone current expenses into handover record
    const recordExpenses = expenses.map(exp => ({ ...exp }));
    handovers.push({ start, end, expenses: recordExpenses, summary });
    saveHandovers();
    // Clear current expenses
    expenses = [];
    saveExpenses();
    // Hide confirm button
    document.getElementById('confirm-handover').classList.add('d-none');
    // Refresh views
    renderSummary();
    renderExpensesList();
    renderHistory();
    // Clear summary display
    document.getElementById('handover-summary').innerHTML = '';
    alert('Handover completed. The period has been moved to history.');
}

// Initialize page
document.addEventListener('DOMContentLoaded', () => {
    // Populate selects for forms and filters
    populateSelect('category', categories);
    populateSelect('payment', paymentMethods);
    populateSelect('payer', members);
    populateSelect('responsible', members, true);
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
    document.getElementById('history-filter-btn').addEventListener('click', renderHistory);
    // Handover buttons
    document.getElementById('generate-handover').addEventListener('click', generateHandover);
    document.getElementById('confirm-handover').addEventListener('click', confirmHandover);
    // Initial render
    renderSummary();
    // Set default chart to overall
    chartSelect.value = 'All';
    renderCategoryChart('All');
});