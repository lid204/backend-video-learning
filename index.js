require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();

app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

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
    // 2. TẠO DỮ LIỆU MẪU ĐỂ TEST TASK 4 (MỚI THÊM)
    console.log("🛠️ Đang chuẩn bị dữ liệu mẫu ID 101...");
    // Tạo User mẫu
    await connection.query("INSERT IGNORE INTO users (id, name, email, password, role) VALUES (1, 'Kiều Zĩ', 'kieu-zi@test.com', '123456', 'student')");
    // Tạo Khóa học mẫu ID 101
    await connection.query("INSERT IGNORE INTO courses (id, title, description, teacher_id) VALUES (101, 'Lập trình ReactJS cho Gen Z', 'Khóa học cực cháy', 1)");
    
    console.log("✅ Toàn bộ 6 bảng Database đã sẵn sàng trên mạng!");
    connection.release();
  })
  .catch((err) => console.error("❌ Lỗi kết nối MySQL:", err));

// --- API ROUTES ---

app.get('/', (req, res) => {
  res.send("🎉 Chào mừng đến với Backend API của Nền tảng Video Bài Giảng!");
});

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
    const { name, email, phone, role, password } = req.body;
    const userRole = role || 'student';
    const userPass = password || '123456';
    const [result] = await pool.query(
      "INSERT INTO users (name, email, phone, role, password) VALUES (?, ?, ?, ?, ?)", 
      [name, email, phone, userRole, userPass]
    );
    res.json({ id: result.insertId, name, email, phone, role: userRole });
  } catch (err) {
    res.status(500).json({ error: "Lỗi thêm user", details: err.message });
  }
});

// API Task 4: Đăng ký học (Ghi danh)
app.post('/api/enrollments', async (req, res) => {
  try {
    const { user_id, course_id } = req.body; // Lấy thông tin từ Frontend gửi lên 
    
    const [result] = await pool.query(
      "INSERT INTO enrollments (user_id, course_id) VALUES (?, ?)", 
      [user_id, course_id]
    );
    
    res.status(201).json({ message: "🎉 Cảm ơn bạn đã ghi danh!", id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: "Đăng ký rồi cu!" });
    res.status(500).json({ error: "Lỗi hệ thống", details: err.message });
  }
});

// API lấy danh sách "Khóa học của tôi" 
app.get('/api/my-courses/:user_id', async (req, res) => {
  try {
    const { user_id } = req.params;
    const [rows] = await pool.query(
      "SELECT c.* FROM courses c JOIN enrollments e ON c.id = e.course_id WHERE e.user_id = ?", 
      [user_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Lỗi lấy dữ liệu" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server Backend đang chạy tại http://localhost:${PORT}`);
});

module.exports = app;