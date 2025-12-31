// Members, categories and payment methods
const members = ['Asim', 'Appy', 'Chire', 'Priyash', 'Pratikshya', 'Asmi'];
const categories = ['Groceries', 'Bills/Utilities', 'Entertainment', 'Dining Out', 'Transport', 'Miscellaneous'];
const paymentMethods = ['Cash', 'Card'];

// Load or initialize expenses
let expenses = JSON.parse(localStorage.getItem('expenses') || '[]');

// Populate selects
function populateSelect(id, options, includeAll = false) {
    const select = document.getElementById(id);
    select.innerHTML = '';
    if (includeAll) {
        const opt = document.createElement('option');
        opt.value = 'All';
        opt.textContent = 'All';
        select.appendChild(opt);
    }
    options.forEach(optValue => {
        const opt = document.createElement('option');
        opt.value = optValue;
        opt.textContent = optValue;
        select.appendChild(opt);
    });
}

populateSelect('category', categories);
populateSelect('payment', paymentMethods);
populateSelect('payer', members);
populateSelect('beneficiaries', members, true);

// Render expenses and summary
function renderExpenses() {
    const tbody = document.getElementById('expenses-body');
    tbody.innerHTML = '';
    expenses.forEach(exp => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${exp.date}</td>
            <td>${exp.title}</td>
            <td>${exp.description || ''}</td>
            <td>$${parseFloat(exp.amount).toFixed(2)}</td>
            <td>${exp.category}</td>
            <td>${exp.payer}</td>
            <td>${exp.beneficiaries.join(', ')}</td>
            <td>${exp.payment}</td>
        `;
        tbody.appendChild(tr);
    });
}

function computeSummary() {
    const summary = {};
    members.forEach(m => {
        summary[m] = { paid: 0, share: 0 };
    });
    expenses.forEach(exp => {
        const amount = parseFloat(exp.amount);
        // Add to payer's paid
        if (summary[exp.payer]) {
            summary[exp.payer].paid += amount;
        }
        // Determine beneficiaries list
        let beneficiaries = exp.beneficiaries;
        let list;
        if (beneficiaries.includes('All')) {
            list = [...members];
        } else {
            list = beneficiaries;
        }
        const share = amount / list.length;
        list.forEach(person => {
            if (summary[person]) {
                summary[person].share += share;
            }
        });
    });
    return summary;
}

function renderSummary() {
    const summary = computeSummary();
    const tbody = document.getElementById('summary-body');
    tbody.innerHTML = '';
    members.forEach(name => {
        const s = summary[name];
        const net = s.share - s.paid;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${name}</td>
            <td>$${s.paid.toFixed(2)}</td>
            <td>$${s.share.toFixed(2)}</td>
            <td>$${net.toFixed(2)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function addExpense(exp) {
    expenses.push(exp);
    localStorage.setItem('expenses', JSON.stringify(expenses));
    renderExpenses();
    renderSummary();
}

// Handle form submission
const form = document.getElementById('expense-form');
form.addEventListener('submit', function(e) {
    e.preventDefault();
    const date = document.getElementById('date').value;
    const title = document.getElementById('title').value;
    const description = document.getElementById('description').value;
    const amount = document.getElementById('amount').value;
    const category = document.getElementById('category').value;
    const payment = document.getElementById('payment').value;
    const payer = document.getElementById('payer').value;
    const beneficiariesSelect = document.getElementById('beneficiaries');
    const selected = Array.from(beneficiariesSelect.selectedOptions).map(opt => opt.value);
    if (!selected || selected.length === 0) {
        alert('Please select at least one beneficiary');
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
        beneficiaries: selected
    };
    addExpense(exp);
    form.reset();
});

// Initial render
renderExpenses();
renderSummary();
