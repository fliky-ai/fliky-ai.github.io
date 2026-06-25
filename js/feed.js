// Конвертер чисел (например: 1500 -> 1.5K)
function formatCount(count) {
    count = parseInt(count) || 0;
    if (count >= 1000000) return (count / 1000000).toFixed(1).replace('.0', '') + 'M';
    if (count >= 1000) return (count / 1000).toFixed(1).replace('.0', '') + 'K';
    return count.toString();
}

function loadVideoFeed() {
    const feedContainer = document.getElementById("video-feed");
    feedContainer.innerHTML = '<div style="text-align:center; padding:50px;">Загрузка ленты...</div>';

    // Запрашиваем у сервера ролики
    socket.emit('get_video_feed', {}, (response) => {
        if (response.status === 'success') {
            renderFeed(response.videos);
        } else {
            feedContainer.innerHTML = '<div style="text-align:center; padding:50px; color:#fe2c55;">Ошибка загрузки видео</div>';
        }
    });
}

function renderFeed(videos) {
    const feedContainer = document.getElementById("video-feed");
    feedContainer.innerHTML = "";

    if (videos.length === 0) {
        feedContainer.innerHTML = '<div style="text-align:center; padding:50px;">Видео пока нет. Загрузите первое!</div>';
        return;
    }

    videos.forEach((video, index) => {
        const slide = document.createElement("div");
        slide.className = "video-slide";
        slide.setAttribute("data-video-id", video.id);

        slide.innerHTML = `
            <video src="${video.video_url}" loop playsinline preload="auto" onclick="togglePlay(this)"></video>
            
            <!-- Правая панель кнопок -->
            <div class="video-actions">
                <div class="action-item" onclick="likeVideo(${video.id}, this)">
                    <div class="action-icon">❤️</div>
                    <span class="like-count">${formatCount(video.likes_count)}</span>
                </div>
                <div class="action-item">
                    <div class="action-icon">👁️</div>
                    <span>${formatCount(video.views_count)}</span>
                </div>
            </div>

            <!-- Нижнее описание видео -->
            <div class="video-meta">
                <div class="author-name">@${video.author.username}</div>
                <div class="video-desc">${video.description || ''}</div>
            </div>
        `;

        feedContainer.appendChild(slide);
    });

    // Настраиваем автоплеер при скролле (свайпах)
    setupIntersectionObserver();
}

function togglePlay(videoElement) {
    if (videoElement.paused) {
        videoElement.play().catch(err => console.log("Ошибка воспроизведения:", err));
    } else {
        videoElement.pause();
    }
}

function setupIntersectionObserver() {
    const observerOptions = {
        root: document.getElementById("video-feed"),
        properties: null,
        threshold: 0.6 // Видео запустится, если его видно больше чем на 60%
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const video = entry.target.querySelector("video");
            if (!video) return;

            if (entry.isIntersecting) {
                video.play().catch(err => console.log("Автоплей заблокирован:", err));
                // Отправляем на сервер сигнал о просмотре
                const videoId = entry.target.getAttribute("data-video-id");
                socket.emit('watch_video', { video_id: videoId });
            } else {
                video.pause();
                video.currentTime = 0; // Сбрасываем в начало при уходе со слайда
            }
        });
    }, observerOptions);

    document.querySelectorAll(".video-slide").forEach(slide => observer.observe(slide));
}

function likeVideo(videoId, element) {
    if (!MY_ID) return; // Проверка авторизации

    socket.emit('toggle_like', { user_id: MY_ID, video_id: videoId }, (response) => {
        if (response.status === 'success') {
            const likeCountSpan = element.querySelector(".like-count");
            likeCountSpan.innerText = formatCount(response.likes_count);
            
            if (response.action === 'liked') {
                element.classList.add("liked");
            } else {
                element.classList.remove("liked");
            }
        }
    });
}

