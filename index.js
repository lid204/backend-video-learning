require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();
app.use(cors());
app.use(express.json());

// --- CẤU HÌNH CLOUDINARY & MULTER ---
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'video_learning_courses', 
    allowedFormats: ['jpg', 'png', 'jpeg']
  }
});
const upload = multer({ storage: storage });

// --- HÀM HỖ TRỢ XỬ LÝ LINK YOUTUBE ---
const extractYouTubeID = (url) => {
    if (!url) return '';
    if (url.includes('v=')) return url.split('v=')[1].substring(0, 11);
    if (url.includes('youtu.be/')) return url.split('youtu.be/')[1].substring(0, 11);
    return url;
};

// --- API NHẬN ẢNH VÀ TRẢ VỀ LINK CLOUDINARY ---
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Không có file ảnh nào được tải lên!' });
  }
  res.json({ imageUrl: req.file.path });
});

// Kết nối với Aiven MySQL Online
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false },
  multipleStatements: true
});

pool.getConnection()
  .then(async (connection) => {
    console.log("✅ Đã kết nối MySQL! Đang khởi tạo bộ Database chuẩn...");

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

    // TẠO DỮ LIỆU MẪU ĐỂ TEST (Từ nhánh ten-branch)
    console.log("🛠️ Đang chuẩn bị dữ liệu mẫu...");
    await connection.query("INSERT IGNORE INTO users (id, name, email, password, role) VALUES (1, 'Kiều Zĩ', 'kieu-zi@test.com', '123456', 'student')");
    await connection.query("INSERT IGNORE INTO courses (id, title, description, teacher_id) VALUES (101, 'Lập trình ReactJS cho Gen Z', 'Khóa học cực cháy', 1)");

    console.log("✅ Toàn bộ 6 bảng Database đã sẵn sàng trên mạng!");
    connection.release();
  })
  .catch((err) => console.error("❌ Lỗi kết nối MySQL:", err));

// ================= API QUẢN LÝ USERS =================
app.get('/api/users', async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM users ORDER BY id DESC");
    res.json(rows);
  } catch (err) { res.status(500).json({ error: "Lỗi lấy dữ liệu" }); }
});

app.get('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query("SELECT * FROM users WHERE id = ?", [id]);
    if (rows.length === 0) return res.status(404).json({ error: "Không tìm thấy user này" });
    res.json(rows[0]); 
  } catch (err) { res.status(500).json({ error: "Lỗi lấy dữ liệu" }); }
});

app.post('/api/users', async (req, res) => {
  try {
    const { name, email, phone, role, password } = req.body;
    const userRole = role || 'student';
    const userPass = password || '123456';
    const [result] = await pool.query(
      "INSERT INTO users (name, email, phone, role, password) VALUES (?, ?, ?, ?, ?)",
      [name, email, phone, userRole, userPass]
    );
    res.json({ id: result.insertId, name, email, phone, role: userRole });
  } catch (err) { res.status(500).json({ error: "Lỗi thêm user", details: err.message }); }
});

app.put('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone, role } = req.body;
    await pool.query(
      "UPDATE users SET name = ?, email = ?, phone = ?, role = ? WHERE id = ?",
      [name, email, phone, role, id]
    );
    res.json({ id, name, email, phone, role });
  } catch (err) { res.status(500).json({ error: "Lỗi cập nhật" }); }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM users WHERE id = ?", [id]);
    res.json({ message: "Xóa thành công" });
  } catch (err) { res.status(500).json({ error: "Lỗi xóa user" }); }
});


// ================= API QUẢN LÝ KHÓA HỌC =================

// 1. Lấy danh sách toàn bộ khóa học (Đã JOIN thêm tên Danh mục)
app.get('/api/courses', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT c.*, cat.name AS category_name 
      FROM courses c 
      LEFT JOIN categories cat ON c.category_id = cat.id 
      ORDER BY c.id DESC
    `);
    res.json(rows);
  } catch (err) { 
    res.status(500).json({ error: "Lỗi lấy danh sách khóa học", details: err.message }); 
  }
});

// 2. Lấy chi tiết 1 khóa học (Phục vụ trang CourseDetail)
app.get('/api/courses/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(`
      SELECT c.*, cat.name AS category_name, u.name AS teacher_name
      FROM courses c 
      LEFT JOIN categories cat ON c.category_id = cat.id 
      LEFT JOIN users u ON c.teacher_id = u.id
      WHERE c.id = ?
    `, [id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: "Không tìm thấy khóa học này" });
    }
    res.json(rows[0]);
  } catch (err) { 
    res.status(500).json({ error: "Lỗi lấy chi tiết khóa học", details: err.message }); 
  }
});

// ... (Giữ nguyên các API POST, PUT, DELETE ở bên dưới của bạn) ...

// ================= API DANH MỤC & ENROLLMENT (TÁCH TỪ CODE LỖI) =================

app.get('/api/categories', async (req, res) => {
  try {
    const [categories] = await pool.query("SELECT * FROM categories");
    res.json(categories);
  } catch (err) { res.status(500).json({ error: "Lỗi lấy danh mục", details: err.message }); }
});

// Chức năng Đăng ký học (Enrollment)
app.post('/api/enrollments', async (req, res) => {
  try {
    const { user_id, course_id } = req.body;
    const [result] = await pool.query(
      "INSERT INTO enrollments (user_id, course_id) VALUES (?, ?)",
      [user_id, course_id]
    );
    res.status(201).json({ message: "🎉 Cảm ơn bạn đã ghi danh!", id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: "Đã đăng ký khóa này rồi!" });
    res.status(500).json({ error: "Lỗi hệ thống" });
  }
});

// Lấy danh sách khóa học của 1 User
app.get('/api/my-courses/:user_id', async (req, res) => {
  try {
    const { user_id } = req.params;
    const [rows] = await pool.query(
      "SELECT c.* FROM courses c JOIN enrollments e ON c.id = e.course_id WHERE e.user_id = ?",
      [user_id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: "Lỗi lấy khóa học của tôi" }); }
});


// ================= CÁC API PHỤ TRỢ =================
app.get('/', (req, res) => {
  res.send("🎉 Chào mừng đến với Backend API của Nền tảng Video Bài Giảng! Hệ thống đang hoạt động hoàn hảo.");
});

app.get('/api/check-db', async (req, res) => {
  try {
    const [tables] = await pool.query("SHOW TABLES");
    const [userColumns] = await pool.query("DESCRIBE users");
    res.json({ message: "Trạng thái Database hiện tại", total_tables: tables.length, tables: tables, users_structure: userColumns });
  } catch (err) { res.status(500).json({ error: "Lỗi soi Database", details: err.message }); }
});

// ================= API QUẢN LÝ BÀI GIẢNG =================

// 1. Lấy danh sách bài giảng theo ID Khóa học
app.get('/api/lessons/course/:course_id', async (req, res) => {
  try {
    const { course_id } = req.params;
    const [rows] = await pool.query(
      "SELECT * FROM lessons WHERE course_id = ? ORDER BY lesson_order ASC",
      [course_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Lỗi lấy danh sách bài giảng" });
  }
});

// 2. Thêm bài giảng mới (Tự động cắt link YouTube lấy ID)
app.post('/api/lessons', async (req, res) => {
  try {
    const { course_id, title, video_url, duration, lesson_order } = req.body;
    const processedUrl = extractYouTubeID(video_url);

    const [result] = await pool.query(
      "INSERT INTO lessons (course_id, title, video_url, duration, lesson_order) VALUES (?, ?, ?, ?, ?)",
      [course_id, title, processedUrl, duration || 0, lesson_order || 1]
    );

    res.status(201).json({
      message: "🎉 Thêm bài giảng thành công!",
      id: result.insertId,
      course_id,
      title,
      video_url: processedUrl
    });
  } catch (error) {
    res.status(500).json({ error: "Lỗi thêm bài giảng", details: error.message });
  }
});

// 3. Cập nhật bài giảng
app.put('/api/lessons/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, video_url, duration, lesson_order } = req.body;
    const processedUrl = extractYouTubeID(video_url);

    await pool.query(
      "UPDATE lessons SET title = ?, video_url = ?, duration = ?, lesson_order = ? WHERE id = ?",
      [title, processedUrl, duration || 0, lesson_order || 1, id]
    );

    res.json({ message: "✅ Cập nhật bài giảng thành công!", video_id_saved: processedUrl });
  } catch (error) {
    res.status(500).json({ error: "Lỗi cập nhật bài giảng", details: error.message });
  }
});

// 4. Xóa bài giảng
app.delete('/api/lessons/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM lessons WHERE id = ?", [id]);
    res.json({ message: "🗑️ Đã xóa bài giảng thành công!" });
  } catch (error) {
    res.status(500).json({ error: "Lỗi xóa bài giảng", details: error.message });
  }
});

// ================= API REVIEWS (CHẤM SAO) =================

// GET: Lấy tất cả reviews của một khóa học
app.get('/api/reviews/:course_id', async (req, res) => {
  try {
    const { course_id } = req.params;
    const [rows] = await pool.query(
      `SELECT r.id, r.rating, r.comment, r.created_at, 
              u.name AS user_name, u.avatar_url
       FROM reviews r
       JOIN users u ON r.user_id = u.id
       WHERE r.course_id = ?
       ORDER BY r.created_at DESC`,
      [course_id]
    );

    const [avgResult] = await pool.query(
      'SELECT AVG(rating) AS avg_rating, COUNT(*) AS total_reviews FROM reviews WHERE course_id = ?',
      [course_id]
    );

    res.json({
      reviews: rows,
      avg_rating: parseFloat(avgResult[0].avg_rating || 0).toFixed(1),
      total_reviews: avgResult[0].total_reviews
    });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi lấy danh sách đánh giá', details: error.message });
  }
});

// POST: Học viên gửi đánh giá mới hoặc cập nhật
app.post('/api/reviews', async (req, res) => {
  try {
    const { user_id, course_id, rating, comment } = req.body;

    if (!user_id || !course_id || !rating) {
      return res.status(400).json({ error: 'Thiếu thông tin bắt buộc (user_id, course_id, rating)' });
    }
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating phải nằm trong khoảng 1-5 sao' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM reviews WHERE user_id = ? AND course_id = ?',
      [user_id, course_id]
    );

    if (existing.length > 0) {
      await pool.query(
        'UPDATE reviews SET rating = ?, comment = ? WHERE user_id = ? AND course_id = ?',
        [rating, comment || '', user_id, course_id]
      );
      res.json({ message: '✅ Đã cập nhật đánh giá của bạn!' });
    } else {
      const [result] = await pool.query(
        'INSERT INTO reviews (user_id, course_id, rating, comment) VALUES (?, ?, ?, ?)',
        [user_id, course_id, rating, comment || '']
      );
      res.status(201).json({ message: '🎉 Cảm ơn bạn đã đánh giá!', id: result.insertId });
    }
  } catch (error) {
    res.status(500).json({ error: 'Lỗi gửi đánh giá', details: error.message });
  }
});

// ================= CHẠY SERVER =================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server Backend đang chạy tại cổng ${PORT}`);
});

module.exports = app;