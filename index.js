require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();
app.use(cors());
app.use(express.json());

// Kết nối với Aiven MySQL Online
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false },
  multipleStatements: true // BẮT BUỘC CÓ: Cho phép chạy 1 cục SQL dài cùng lúc
});

pool.getConnection()
  .then(async (connection) => {
    console.log("✅ Đã kết nối MySQL! Đang khởi tạo bộ Database chuẩn...");
    
    // Chạy cục SQL tạo 6 bảng (Bỏ qua nếu đã có)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS categories (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          description TEXT
      );

      CREATE TABLE IF NOT EXISTS users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          email VARCHAR(100) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL DEFAULT '123456',
          phone VARCHAR(20),
          role ENUM('student', 'teacher', 'admin') DEFAULT 'student',
          avatar_url VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS courses (
          id INT AUTO_INCREMENT PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          thumbnail_url VARCHAR(255),
          teacher_id INT NOT NULL,
          category_id INT,
          price DECIMAL(10,2) DEFAULT 0.00,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS lessons (
          id INT AUTO_INCREMENT PRIMARY KEY,
          course_id INT NOT NULL,
          title VARCHAR(255) NOT NULL,
          video_url VARCHAR(255) NOT NULL,
          duration INT,
          lesson_order INT DEFAULT 1,
          FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS enrollments (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          course_id INT NOT NULL,
          progress_percent INT DEFAULT 0,
          enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
          UNIQUE(user_id, course_id)
      );

      CREATE TABLE IF NOT EXISTS reviews (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          course_id INT NOT NULL,
          rating INT CHECK (rating >= 1 AND rating <= 5),
          comment TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
      );
    `);
    console.log("✅ Toàn bộ 6 bảng Database đã sẵn sàng trên mạng!");
    connection.release();
  })
  .catch((err) => console.error("❌ Lỗi kết nối MySQL:", err));

// ==========================================
// ĐỊNH NGHĨA CÁC ROUTE (API) TẠI ĐÂY
// ==========================================

// Lời chào khi truy cập link gốc
app.get('/', (req, res) => {
  res.send("🎉 Chào mừng đến với Backend API của Nền tảng Video Bài Giảng! Hãy gõ thêm /api/users trên thanh địa chỉ để xem dữ liệu nhé.");
});

// API KIỂM TRA DATABASE (Dành riêng cho Admin)
app.get('/api/check-pool', async (req, res) => {
  try {
    const [tables] = await pool.query("SHOW TABLES");
    const [userColumns] = await pool.query("DESCRIBE users");

    res.json({
      message: "Trạng thái Database hiện tại",
      total_tables: tables.length,
      tables: tables,
      users_structure: userColumns
    });
  } catch (err) {
    res.status(500).json({ error: "Lỗi soi Database", details: err.message });
  }
});

// ------------------------------------------
// API USERS
// ------------------------------------------

app.get('/api/users', async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM users ORDER BY id DESC");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Lỗi lấy dữ liệu" });
  }
});

app.get('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query("SELECT * FROM users WHERE id = ?", [id]);
    if (rows.length === 0) return res.status(404).json({ error: "Không tìm thấy user này" });
    res.json(rows[0]); 
  } catch (err) {
    res.status(500).json({ error: "Lỗi lấy dữ liệu" });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    const [result] = await pool.query("INSERT INTO users (name, email, phone) VALUES (?, ?, ?)", [name, email, phone]);
    res.json({ id: result.insertId, name, email, phone });
  } catch (err) {
    res.status(500).json({ error: "Lỗi thêm user" });
  }
});

app.put('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone } = req.body;
    await pool.query("UPDATE users SET name = ?, email = ?, phone = ? WHERE id = ?", [name, email, phone, id]);
    res.json({ id, name, email, phone });
  } catch (err) {
    res.status(500).json({ error: "Lỗi cập nhật" });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM users WHERE id = ?", [id]);
    res.json({ message: "Xóa thành công" });
  } catch (err) {
    res.status(500).json({ error: "Lỗi xóa user" });
  }
});

// ------------------------------------------
// API COURSES
// ------------------------------------------

app.get('/api/courses', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM courses');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/courses', async (req, res) => {
    const { title, description, teacher_id = 1 } = req.body;
    try {
        const [result] = await pool.query(
            'INSERT INTO courses (title, description, teacher_id) VALUES (?, ?, ?)',
            [title, description, teacher_id]
        );
        res.status(201).json({ id: result.insertId, title, description, teacher_id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// ĐỒ CHƠI CÔNG NGHỆ: YOUTUBE REGEX (TASK 3)
// ==========================================
const extractYouTubeID = (url) => {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
};

// ------------------------------------------
// API LESSONS (TASK 3)
// ------------------------------------------

// 1. GET: Lấy danh sách bài giảng của 1 khóa học cụ thể
app.get('/api/courses/:courseId/lessons', async (req, res) => {
  try {
    const { courseId } = req.params;
    const [rows] = await pool.query(
      "SELECT * FROM lessons WHERE course_id = ? ORDER BY lesson_order ASC", 
      [courseId]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Lỗi lấy danh sách bài giảng", details: error.message });
  }
});

// 2. POST: Thêm bài giảng mới (Tích hợp Regex bắt link YouTube)
app.post('/api/lessons', async (req, res) => {
  try {
    const { course_id, title, video_url, duration, lesson_order } = req.body;
    
    // Bắt lỗi và cắt link YouTube
    const videoId = extractYouTubeID(video_url);
    if (!videoId) {
      return res.status(400).json({ error: "Link YouTube không hợp lệ! Hãy dán link đúng định dạng." });
    }

    const [result] = await pool.query(
      "INSERT INTO lessons (course_id, title, video_url, duration, lesson_order) VALUES (?, ?, ?, ?, ?)",
      [course_id, title, videoId, duration || 0, lesson_order || 1]
    );
    
    res.status(201).json({ 
      message: "🎉 Thêm bài giảng thành công!", 
      id: result.insertId, 
      course_id, 
      title, 
      video_id_saved: videoId 
    });
  } catch (error) {
    res.status(500).json({ error: "Lỗi thêm bài giảng", details: error.message });
  }
});

// 3. PUT: Cập nhật bài giảng
app.put('/api/lessons/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, video_url, duration, lesson_order } = req.body;
    
    let finalVideoUrl = video_url;
    if (video_url && (video_url.includes('youtu.be') || video_url.includes('youtube.com'))) {
      const videoId = extractYouTubeID(video_url);
      if (!videoId) return res.status(400).json({ error: "Link YouTube cập nhật không hợp lệ!" });
      finalVideoUrl = videoId;
    }

    await pool.query(
      "UPDATE lessons SET title = ?, video_url = ?, duration = ?, lesson_order = ? WHERE id = ?",
      [title, finalVideoUrl, duration, lesson_order, id]
    );
    
    res.json({ message: "✅ Cập nhật bài giảng thành công!", video_id_saved: finalVideoUrl });
  } catch (error) {
    res.status(500).json({ error: "Lỗi cập nhật bài giảng", details: error.message });
  }
});

// 4. DELETE: Xóa bài giảng
app.delete('/api/lessons/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM lessons WHERE id = ?", [id]);
    res.json({ message: "🗑️ Đã xóa bài giảng thành công!" });
  } catch (error) {
    res.status(500).json({ error: "Lỗi xóa bài giảng", details: error.message });
  }
});

// ==========================================
// CHẠY SERVER
// ==========================================

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server Backend đang chạy tại http://localhost:${PORT}`);
});

// DÒNG NÀY ĐỂ VERCEL CHẠY ĐƯỢC API
module.exports = app;