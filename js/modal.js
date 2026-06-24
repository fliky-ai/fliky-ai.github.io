// ============ КАСТОМНЫЙ МОДАЛЬНЫЙ ПОПАП ============

function showModal(options) {
    return new Promise((resolve) => {
        const modal = document.getElementById('custom-modal');
        const title = document.getElementById('modal-title');
        const subtitle = document.getElementById('modal-subtitle');
        const input = document.getElementById('modal-input');
        const confirmBtn = document.getElementById('modal-confirm');
        const cancelBtn = document.getElementById('modal-cancel');

        title.textContent = options.title || 'Введите значение';
        subtitle.textContent = options.subtitle || '';
        input.value = options.defaultValue || '';
        input.placeholder = options.placeholder || 'Введите текст...';
        input.type = options.type || 'text';
        input.maxLength = options.maxLength || 100;
        confirmBtn.textContent = options.confirmText || 'OK';
        cancelBtn.textContent = options.cancelText || 'Отмена';
        input.style.display = 'block';

        modal.classList.add('active');

        setTimeout(() => {
            input.focus();
            input.select();
        }, 100);

        function cleanup() {
            modal.classList.remove('active');
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            input.removeEventListener('keydown', onKeydown);
        }

        function onConfirm() {
            const value = input.value.trim();
            if (value || options.allowEmpty) {
                cleanup();
                resolve(value);
            } else {
                input.style.borderColor = '#ff3b30';
                setTimeout(() => {
                    input.style.borderColor = 'var(--tg-border-color)';
                }, 1000);
            }
        }

        function onCancel() {
            cleanup();
            resolve(null);
        }

        function onKeydown(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                onConfirm();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
            }
        }

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
        input.addEventListener('keydown', onKeydown);

        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                onCancel();
            }
        });
    });
}

function showAlert(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('custom-modal');
        const title = document.getElementById('modal-title');
        const subtitle = document.getElementById('modal-subtitle');
        const input = document.getElementById('modal-input');
        const confirmBtn = document.getElementById('modal-confirm');
        const cancelBtn = document.getElementById('modal-cancel');

        title.textContent = 'ℹ️';
        subtitle.textContent = message || '';
        input.style.display = 'none';
        confirmBtn.textContent = 'OK';
        cancelBtn.style.display = 'none';

        modal.classList.add('active');

        function cleanup() {
            modal.classList.remove('active');
            input.style.display = 'block';
            cancelBtn.style.display = 'block';
            confirmBtn.removeEventListener('click', onConfirm);
        }

        function onConfirm() {
            cleanup();
            resolve();
        }

        confirmBtn.addEventListener('click', onConfirm);
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                onConfirm();
            }
        });
    });
}
