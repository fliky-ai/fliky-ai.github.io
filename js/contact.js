// ============ КОНТАКТЫ ============
function loadContacts() {
    if (!socket || !isConnected) return;
    
    socket.emit('get_contacts', {}, (contacts) => {
        const contactsList = document.getElementById('contacts-list');
        contactsList.innerHTML = '';
        
        if (contacts && contacts.length > 0) {
            contacts.forEach(contact => {
                const div = document.createElement('div');
                div.className = 'chat-item';
                div.innerHTML = `
                    <div class="chat-avatar" style="background:linear-gradient(135deg, ${getAvatarColor(contact.first_name || 'U')}, #366187);">
                        ${(contact.first_name || 'U').substring(0,2).toUpperCase()}
                    </div>
                    <div class="chat-details">
                        <div class="chat-title-row">
                            <div class="chat-name">${contact.first_name || 'User'} ${contact.is_verified ? '✅' : ''}</div>
                        </div>
                        <div class="chat-preview">@${contact.username || ''}</div>
                    </div>
                `;
                div.onclick = () => {
                    if (!dynamicChats[contact.telegram_id]) {
                        dynamicChats[contact.telegram_id] = {
                            first_name: contact.first_name || `User ${contact.telegram_id}`,
                            username: contact.username || ''
                        };
                        createChatRow(contact.telegram_id, contact.first_name || `User ${contact.telegram_id}`, contact.username || '', contact.is_verified);
                    }
                    openChat(contact.telegram_id, contact.first_name || `User ${contact.telegram_id}`, contact.is_verified);
                };
                contactsList.appendChild(div);
            });
        } else {
            contactsList.innerHTML = `
                <div style="padding:40px 20px;text-align:center;color:var(--tg-text-secondary);">
                    <div style="font-size:48px;margin-bottom:16px;">👥</div>
                    <div style="font-size:16px;font-weight:500;">Нет контактов</div>
                    <div style="font-size:13px;margin-top:4px;">Добавьте пользователей в контакты</div>
                </div>
            `;
        }
    });
}