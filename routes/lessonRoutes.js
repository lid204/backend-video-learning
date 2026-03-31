// routes/lessonRoutes.js
const express = require('express');
const router = express.Router();
const { extractYouTubeID } = require('../utils/youtube');

// Import file kết nối Database của bạn (VD: const db = require('../db');)
// Lưu ý: Thay đổi đường dẫn '../db' sao cho khớp với project của bạn

// 1. LẤY DANH SÁCH BÀI GIẢNG CỦA 1 KHÓA HỌC (GET)
router.get('/courses/:courseId/lessons', async (req, res) => {
    try {
        const { courseId } = req.params;
        // Code SQL mẫu: SELECT * FROM lessons WHERE course_id = ? ORDER BY order_index ASC
        // const [lessons] = await db.execute('...', [courseId]);
        res.status(200).json({ message: "Lấy danh sách thành công", data: [] }); // Sửa data thành mảng bài giảng lấy từ DB
    } catch (error) {
        res.status(500).json({ message: "Lỗi server", error: error.message });
    }
});

// 2. THÊM BÀI GIẢNG MỚI & XỬ LÝ LINK YOUTUBE (POST)
router.post('/lessons', async (req, res) => {
    try {
        const { course_id, title, video_url, order_index } = req.body;

        // Xử lý link YouTube bằng Regex
        const videoId = extractYouTubeID(video_url);
        if (!videoId) {
            return res.status(400).json({ message: "Link YouTube không hợp lệ!" });
        }

        // Code SQL mẫu: INSERT INTO lessons (course_id, title, video_id, order_index) VALUES (?, ?, ?, ?)
        // await db.execute('...', [course_id, title, videoId, order_index]);

        res.status(201).json({ 
            message: "Thêm bài giảng thành công!", 
            videoId: videoId 
        });
    } catch (error) {
        res.status(500).json({ message: "Lỗi server", error: error.message });
    }
});

// Tương tự, bạn viết thêm PUT /lessons/:id và DELETE /lessons/:id ở đây...

module.exports = router;