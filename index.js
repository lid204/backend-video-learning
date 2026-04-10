require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

const app = express();
app.use(cors({
    origin: [
        "https://frontend-video-learning-lid204s-projects.vercel.app",
        "http://localhost:5173"
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
}));
app.use(express.json());
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: { folder: 'video_learning_courses', allowedFormats: ['jpg', 'png', 'jpeg'] }
});
const upload = multer({ storage: storage });

const extractYouTubeID = (url) => { return url; };

app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Chưa chọn ảnh ní ơi!' });
  res.json({ imageUrl: req.file.path });
});

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false },
  multipleStatements: true
});

pool.getConnection().then(async (connection) => {
    console.log("✅ MySQL Ready!");
    await connection.query(`
      CREATE TABLE IF NOT EXISTS categories (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL);
      CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100), email VARCHAR(100) UNIQUE, password VARCHAR(255) DEFAULT '123456', role ENUM('student', 'teacher', 'admin') DEFAULT 'student');
      CREATE TABLE IF NOT EXISTS courses (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255), thumbnail_url VARCHAR(255), price DECIMAL(10,2) DEFAULT 0.00, description TEXT, category_id INT, FOREIGN KEY (category_id) REFERENCES categories(id));
      CREATE TABLE IF NOT EXISTS sections (id INT AUTO_INCREMENT PRIMARY KEY, course_id INT, title VARCHAR(255), order_index INT DEFAULT 0, FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS lessons (id INT AUTO_INCREMENT PRIMARY KEY, section_id INT, title VARCHAR(255), video_url VARCHAR(255), duration INT DEFAULT 0, order_index INT DEFAULT 1, FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE);
    `);
    
    // 👇 THUỐC GIẢI: Tự động thêm cột teacher_id bị thiếu vào bảng courses
    try {
        await connection.query("ALTER TABLE courses ADD COLUMN teacher_id INT");
        console.log("✅ Đã vá lỗi thêm cột teacher_id thành công!");
    } catch (e) {
        // Bỏ qua lỗi nếu cột này đã được tạo từ trước
    }

    connection.release();
}).catch(err => console.error("❌ DB Error:", err));

// ================= API QUẢN LÝ USER (TỪ NHÁNH DANH) =================

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

// 1. Lấy danh sách toàn bộ khóa học (Đã JOIN thêm tên Danh mục - Nâng cấp của Danh)
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

// 2. Lấy chi tiết 1 khóa học (Phục vụ trang CourseDetail - Của Danh)
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

// LƯU Ý: MÌNH ĐÃ XÓA CÁI API app.post('/api/courses') BỊ TRÙNG VÀ BỊ LỖI Ở ĐÂY ĐI RỒI!

// 4. XÓA KHÓA HỌC (Từ nhánh Main)
app.delete('/api/courses/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM courses WHERE id = ?", [id]);
    res.json({ message: "Xóa thành công" });
  } catch (err) {
    res.status(500).json({ error: "Lỗi xóa khóa học" });
  }
});


// ================= API QUẢN LÝ BÀI GIẢNG (CURRICULUM) =================

app.get('/api/courses/:course_id/curriculum', async (req, res) => {
  try {
    const { course_id } = req.params;
    const [sections] = await pool.query("SELECT * FROM sections WHERE course_id = ? ORDER BY order_index ASC", [course_id]);
    const curriculum = await Promise.all(sections.map(async (sec) => {
      const [lessons] = await pool.query("SELECT * FROM lessons WHERE section_id = ? ORDER BY order_index ASC", [sec.id]);
      return { ...sec, lessons };
    }));
    res.json(curriculum);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/sections', async (req, res) => {
  try {
    const { course_id, title, order_index } = req.body;
    const [result] = await pool.query("INSERT INTO sections (course_id, title, order_index) VALUES (?, ?, ?)", [course_id, title, order_index || 0]);
    res.status(201).json({ message: "OK", id: result.insertId });
  } catch (err) { res.status(500).json({ error: "Lỗi thêm chương" }); }
});

app.post('/api/lessons', async (req, res) => {
  try {
    const { section_id, title, video_url, order_index } = req.body;
    const [result] = await pool.query("INSERT INTO lessons (section_id, title, video_url, order_index) VALUES (?, ?, ?, ?)", [section_id, title, extractYouTubeID(video_url), order_index || 1]);
    res.status(201).json({ id: result.insertId });
  } catch (err) { res.status(500).json({ error: "Lỗi thêm bài" }); }
});


// ================= API THỐNG KÊ ADMIN DASHBOARD (TỪ NHÁNH CỦA PHONG) =================

// 1. Thống kê doanh thu theo tháng/ngày
app.get('/api/stats/revenue', async (req, res) => {
  try {
    const { period } = req.query; 
    let query;
    if (period === 'daily') {
      query = `
        SELECT 
          DATE(e.enrolled_at) AS label,
          SUM(c.price) AS revenue,
          COUNT(e.id) AS orders
        FROM enrollments e
        JOIN courses c ON e.course_id = c.id
        WHERE e.enrolled_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY DATE(e.enrolled_at)
        ORDER BY label ASC
      `;
    } else {
      query = `
        SELECT 
          DATE_FORMAT(e.enrolled_at, '%Y-%m') AS label,
          SUM(c.price) AS revenue,
          COUNT(e.id) AS orders
        FROM enrollments e
        JOIN courses c ON e.course_id = c.id
        GROUP BY DATE_FORMAT(e.enrolled_at, '%Y-%m')
        ORDER BY label ASC
        LIMIT 12
      `;
    }
    const [rows] = await pool.query(query);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi thống kê doanh thu', details: err.message });
  }
});

// 2. Top 5 khóa học có nhiều học viên nhất
app.get('/api/stats/top-courses', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        c.id,
        c.title,
        c.thumbnail_url,
        c.price,
        COUNT(e.id) AS student_count,
        COALESCE(AVG(r.rating), 0) AS avg_rating
      FROM courses c
      LEFT JOIN enrollments e ON c.id = e.course_id
      LEFT JOIN reviews r ON c.id = r.course_id
      GROUP BY c.id, c.title, c.thumbnail_url, c.price
      ORDER BY student_count DESC
      LIMIT 5
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Lỗi lấy top khóa học', details: err.message });
  }
});

// 3. Tỉ lệ hoàn thành bài học trung bình
app.get('/api/stats/completion-rate', async (req, res) => {
  try {
    const [overall] = await pool.query(`
      SELECT 
        COALESCE(AVG(progress_percent), 0) AS avg_completion,
        COUNT(CASE WHEN progress_percent = 100 THEN 1 END) AS completed_count,
        COUNT(CASE WHEN progress_percent > 0 AND progress_percent < 100 THEN 1 END) AS in_progress_count,
        COUNT(CASE WHEN progress_percent = 0 THEN 1 END) AS not_started_count,
        COUNT(*) AS total_enrollments
      FROM enrollments
    `);
    const [byCourse] = await pool.query(`
      SELECT 
        c.title AS course_title,
        COALESCE(AVG(e.progress_percent), 0) AS avg_completion,
        COUNT(e.id) AS total_students
      FROM enrollments e
      JOIN courses c ON e.course_id = c.id
      GROUP BY c.id, c.title
      ORDER BY avg_completion DESC
      LIMIT 5
    `);
    res.json({
      overall: overall[0],
      by_course: byCourse
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi thống kê hoàn thành', details: err.message });
  }
});

// 4. Tổng số user mới đăng ký trong tháng + tổng quan hệ thống
app.get('/api/stats/overview', async (req, res) => {
  try {
    const [newUsers] = await pool.query(`
      SELECT COUNT(*) AS new_users_this_month
      FROM users
      WHERE MONTH(created_at) = MONTH(NOW()) AND YEAR(created_at) = YEAR(NOW())
    `);
    const [totalUsers] = await pool.query(`SELECT COUNT(*) AS total FROM users`);
    const [totalCourses] = await pool.query(`SELECT COUNT(*) AS total FROM courses`);
    const [totalEnrollments] = await pool.query(`SELECT COUNT(*) AS total FROM enrollments`);
    const [totalRevenue] = await pool.query(`
      SELECT COALESCE(SUM(c.price), 0) AS total_revenue
      FROM enrollments e
      JOIN courses c ON e.course_id = c.id
    `);
    const [revenueThisMonth] = await pool.query(`
      SELECT COALESCE(SUM(c.price), 0) AS revenue_this_month
      FROM enrollments e
      JOIN courses c ON e.course_id = c.id
      WHERE MONTH(e.enrolled_at) = MONTH(NOW()) AND YEAR(e.enrolled_at) = YEAR(NOW())
    `);
    res.json({
      new_users_this_month: newUsers[0].new_users_this_month,
      total_users: totalUsers[0].total,
      total_courses: totalCourses[0].total,
      total_enrollments: totalEnrollments[0].total,
      total_revenue: totalRevenue[0].total_revenue,
      revenue_this_month: revenueThisMonth[0].revenue_this_month
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi thống kê tổng quan', details: err.message });
  }
});

// ================= API DANH MỤC (MODULE CỦA DUY) =================
// [GET] Lấy danh sách danh mục
app.get('/api/categories', async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT * FROM categories");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: "Lỗi máy chủ" });
    }
});

// [POST] Thêm danh mục mới (Dành cho Admin)
app.post('/api/categories', async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ error: "Tên không hợp lệ" });
        
        const [result] = await pool.query("INSERT INTO categories (name) VALUES (?)", [name]);
        res.json({ id: result.insertId, name });
    } catch (err) {
        res.status(500).json({ error: "Lỗi DB" });
    }
});

// 3. LƯU KHÓA HỌC (ĐÃ SỬA: Thêm category_id và teacher_id)
app.post('/api/courses', async (req, res) => {
  try {
    const { title, description, price, thumbnail_url, category_id } = req.body; 
    
    const [result] = await pool.query(
      "INSERT INTO courses (title, description, price, thumbnail_url, teacher_id, category_id) VALUES (?, ?, ?, ?, ?, ?)",
      [title, description || '', price || 0, thumbnail_url || '', 1, category_id || null] 
    );
    res.status(201).json({ message: "OK", id: result.insertId });
  } catch (err) { 
    console.error(err);
    res.status(500).json({ error: "Lỗi lưu khóa học" }); 
  }
});

// ================= CHẠY SERVER =================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server Backend đang chạy tại cổng ${PORT}`);
});