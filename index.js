require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();
app.use(cors());
app.use(express.json());

// --- CẤU HÌNH CLOUDINARY & MULTER (TASK 2) ---
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
    folder: 'video_learning_courses', // Tên thư mục trên Cloudinary
    allowedFormats: ['jpg', 'png', 'jpeg']
  }
});
const upload = multer({ storage: storage });

// --- API NHẬN ẢNH VÀ TRẢ VỀ LINK CLOUDINARY ---
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Không có file ảnh nào được tải lên!' });
  }
  // Nếu upload thành công, trả về đường link ảnh của Cloudinary
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


// ================= API QUẢN LÝ KHÓA HỌC (TASK 2) =================

app.get('/api/courses', async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM courses ORDER BY id DESC");
    res.json(rows);
  } catch (err) { res.status(500).json({ error: "Lỗi lấy danh sách khóa học" }); }
});

app.post('/api/courses', async (req, res) => {
  try {
    const { title, description, thumbnail_url, teacher_id, category_id, price } = req.body;
    const t_id = teacher_id || 1; 
    const [result] = await pool.query(
      "INSERT INTO courses (title, description, thumbnail_url, teacher_id, category_id, price) VALUES (?, ?, ?, ?, ?, ?)",
      [title, description, thumbnail_url, t_id, category_id || null, price || 0]
    );
    res.json({ message: "Thêm khóa học thành công!", id: result.insertId });
  } catch (err) { res.status(500).json({ error: "Lỗi thêm khóa học", details: err.message }); }
});

app.put('/api/courses/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, thumbnail_url, price } = req.body;
    await pool.query(
      "UPDATE courses SET title = ?, description = ?, thumbnail_url = ?, price = ? WHERE id = ?",
      [title, description, thumbnail_url, price, id]
    );
    res.json({ message: "Cập nhật thành công!" });
  } catch (err) { res.status(500).json({ error: "Lỗi cập nhật khóa học" }); }
});

app.delete('/api/courses/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM courses WHERE id = ?", [id]);
    res.json({ message: "Xóa khóa học thành công!" });
  } catch (err) { res.status(500).json({ error: "Lỗi xóa khóa học" }); }
});

// ================= API TASK 1: TRANG CHỦ & KHÁM PHÁ =================
app.get('/api/categories', async (req, res) => {
  try {
    const [categories] = await pool.query("SELECT * FROM categories");
    res.json(categories);
  } catch (err) { res.status(500).json({ error: "Lỗi lấy danh mục", details: err.message }); }
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
    const [rows] = await pool.query("SELECT * FROM lessons WHERE course_id = ?", [course_id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Lỗi lấy danh sách bài giảng" });
  }
});

// 2. Thêm bài giảng mới (Tự động cắt link YouTube lấy ID)
app.post('/api/lessons', async (req, res) => {
  try {
    const { course_id, title, video_url } = req.body;
    
    // Logic tự động cắt link YouTube dài thành mã ID ngắn gọn
    let videoId = video_url;
    if (video_url.includes('v=')) {
        videoId = video_url.split('v=')[1].substring(0, 11);
    } else if (video_url.includes('youtu.be/')) {
        videoId = video_url.split('youtu.be/')[1].substring(0, 11);
    }

    const [result] = await pool.query(
      "INSERT INTO lessons (course_id, title, video_url) VALUES (?, ?, ?)",
      [course_id, title, videoId]
    );
    res.json({ message: "Thêm thành công", id: result.insertId, video_url: videoId });
  } catch (err) {
    res.status(500).json({ error: "Lỗi thêm bài giảng", details: err.message });
  }
});
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server Backend đang chạy tại cổng ${PORT}`);
});

module.exports = app;