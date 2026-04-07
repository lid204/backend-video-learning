require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

const app = express();
app.use(cors({
  origin: "https://frontend-video-learning-lid204s-projects.vercel.app",
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
      CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100), email VARCHAR(100) UNIQUE, password VARCHAR(255) DEFAULT '123456', role ENUM('student', 'teacher', 'admin') DEFAULT 'student');
      CREATE TABLE IF NOT EXISTS courses (id INT AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255), thumbnail_url VARCHAR(255), price DECIMAL(10,2) DEFAULT 0.00, description TEXT);
      CREATE TABLE IF NOT EXISTS sections (id INT AUTO_INCREMENT PRIMARY KEY, course_id INT, title VARCHAR(255), order_index INT DEFAULT 0, FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS lessons (id INT AUTO_INCREMENT PRIMARY KEY, section_id INT, title VARCHAR(255), video_url VARCHAR(255), duration INT DEFAULT 0, order_index INT DEFAULT 1, FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE);
    `);
    connection.release();
}).catch(err => console.error("❌ DB Error:", err));

app.get('/api/users', async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM users");
  res.json(rows);
});

// --- API LƯU KHÓA HỌC (ĐÃ FIX: LƯU ĐƯỢC MÔ TẢ VÀ TEACHER_ID) ---
app.post('/api/courses', async (req, res) => {
  try {
    const { title, description, price, thumbnail_url } = req.body;
    const [result] = await pool.query(
      "INSERT INTO courses (title, description, price, thumbnail_url, teacher_id) VALUES (?, ?, ?, ?, ?)",
      [title, description || '', price || 0, thumbnail_url || '', 1] 
    );
    res.status(201).json({ message: "OK", id: result.insertId });
  } catch (err) { 
    console.error(err);
    res.status(500).json({ error: "Lỗi lưu khóa học" }); 
  }
});

// --- API XÓA KHÓA HỌC ---
app.delete('/api/courses/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM courses WHERE id = ?", [id]);
    res.json({ message: "Xóa thành công" });
  } catch (err) {
    res.status(500).json({ error: "Lỗi xóa khóa học" });
  }
});

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

app.get('/api/courses', async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM courses ORDER BY id DESC");
  res.json(rows);
});

const PORT = 5000;
app.listen(PORT, () => console.log(`🚀 Server on ${PORT}`));