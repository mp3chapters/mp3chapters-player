export function installPodcastNavigation({ panel, list, searchInput }) {
    panel.addEventListener('keydown', event => {
        if (panel.classList.contains('hidden') || event.altKey || event.ctrlKey || event.metaKey) return;
        const rows = Array.from(list.querySelectorAll('[data-podcast-row]'));
        if (!rows.length) return;
        const fromSearch = event.target === searchInput;
        const currentRow = event.target.closest('.podcast-item')?.querySelector('[data-podcast-row]');
        const index = rows.indexOf(currentRow);
        let target;
        if (fromSearch && event.key === 'ArrowDown') target = rows[0];
        else if (index >= 0) {
            if (event.key === 'ArrowDown') target = rows[Math.min(index + 1, rows.length - 1)];
            if (event.key === 'ArrowUp') target = index === 0 && searchInput.parentElement.style.display !== 'none' ? searchInput : rows[Math.max(0, index - 1)];
            if (event.key === 'Home') target = rows[0];
            if (event.key === 'End') target = rows[rows.length - 1];
        }
        if (target) {
            event.preventDefault();
            event.stopPropagation();
            target.focus();
            target.scrollIntoView({ block: 'nearest' });
        }
    });
}
