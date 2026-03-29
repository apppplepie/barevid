-- Docker MySQL 首次初始化用（docker-entrypoint-initdb.d）；与仓库根目录 barevid.sql 保持同步即可。
USE `barevid`;

/*
 Navicat Premium Data Transfer

 Source Server         : slideforge
 Source Server Type    : MySQL
 Source Server Version : 80408 (8.4.8)
 Source Host           : localhost:3307
 Source Schema         : barevid

 Target Server Type    : MySQL
 Target Server Version : 80408 (8.4.8)
 File Encoding         : 65001

 Date: 29/03/2026 20:07:41
*/

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------
-- Table structure for auth_sessions
-- ----------------------------
DROP TABLE IF EXISTS `auth_sessions`;
CREATE TABLE `auth_sessions`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `token_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `expires_at` datetime NOT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `ix_auth_sessions_token_hash`(`token_hash` ASC) USING BTREE,
  INDEX `ix_auth_sessions_user_id`(`user_id` ASC) USING BTREE,
  CONSTRAINT `auth_sessions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 4 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for node_contents
-- ----------------------------
DROP TABLE IF EXISTS `node_contents`;
CREATE TABLE `node_contents`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `node_id` int NOT NULL,
  `page_code` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `page_deck_status` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `page_deck_error` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `narration_text` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `narration_brief` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `duration_ms` int NULL DEFAULT NULL,
  `narration_alignment_json` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `audio_sequence` int NOT NULL,
  `audio_asset_id` int NULL DEFAULT NULL,
  `image_asset_id` int NULL DEFAULT NULL,
  `background_asset_id` int NULL DEFAULT NULL,
  `scene_style_json` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `enter_transition` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `exit_transition` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `ix_node_contents_node_id`(`node_id` ASC) USING BTREE,
  CONSTRAINT `node_contents_ibfk_1` FOREIGN KEY (`node_id`) REFERENCES `outline_nodes` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 21 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for outline_nodes
-- ----------------------------
DROP TABLE IF EXISTS `outline_nodes`;
CREATE TABLE `outline_nodes`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `parent_id` int NULL DEFAULT NULL,
  `sort_order` int NOT NULL,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `node_kind` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `subtree_has_content` tinyint(1) NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `ix_outline_nodes_parent_id`(`parent_id` ASC) USING BTREE,
  INDEX `ix_outline_nodes_project_id`(`project_id` ASC) USING BTREE,
  CONSTRAINT `outline_nodes_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `outline_nodes_ibfk_2` FOREIGN KEY (`parent_id`) REFERENCES `outline_nodes` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 21 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for project_styles
-- ----------------------------
DROP TABLE IF EXISTS `project_styles`;
CREATE TABLE `project_styles`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `origin_project_id` int NULL DEFAULT NULL,
  `style_preset` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_style_hint` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `style_prompt_text` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `style_data_json` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `style_base_json` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `version` int NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `ix_project_styles_origin_project_id`(`origin_project_id` ASC) USING BTREE,
  CONSTRAINT `project_styles_ibfk_1` FOREIGN KEY (`origin_project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 5 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for projects
-- ----------------------------
DROP TABLE IF EXISTS `projects`;
CREATE TABLE `projects`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `owner_user_id` int NOT NULL,
  `user_id` int NULL DEFAULT NULL,
  `is_shared` tinyint(1) NOT NULL,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `input_prompt` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `aspect_ratio` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `deck_width` int NULL DEFAULT NULL,
  `deck_height` int NULL DEFAULT NULL,
  `style_id` int NULL DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `ix_projects_user_id`(`user_id` ASC) USING BTREE,
  INDEX `ix_projects_owner_user_id`(`owner_user_id` ASC) USING BTREE,
  INDEX `style_id`(`style_id` ASC) USING BTREE,
  CONSTRAINT `projects_ibfk_1` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `projects_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `projects_ibfk_3` FOREIGN KEY (`style_id`) REFERENCES `project_styles` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 5 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for users
-- ----------------------------
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `ix_users_username`(`username` ASC) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 2 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for video_export_jobs
-- ----------------------------
DROP TABLE IF EXISTS `video_export_jobs`;
CREATE TABLE `video_export_jobs`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `status` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `width` int NOT NULL,
  `height` int NOT NULL,
  `request_authorization` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `error_message` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `worker_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  `started_at` datetime NULL DEFAULT NULL,
  `finished_at` datetime NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `ix_video_export_jobs_project_id`(`project_id` ASC) USING BTREE,
  CONSTRAINT `video_export_jobs_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 3 CHARACTER SET = utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for workflow_artifacts
-- ----------------------------
DROP TABLE IF EXISTS `workflow_artifacts`;
CREATE TABLE `workflow_artifacts`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `workflow_run_id` int NOT NULL,
  `step_key` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `artifact_type` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_url` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `meta_json` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `ix_workflow_artifacts_artifact_type`(`artifact_type` ASC) USING BTREE,
  INDEX `ix_workflow_artifacts_step_key`(`step_key` ASC) USING BTREE,
  INDEX `ix_workflow_artifacts_workflow_run_id`(`workflow_run_id` ASC) USING BTREE,
  CONSTRAINT `workflow_artifacts_ibfk_1` FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 5 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for workflow_export_runs
-- ----------------------------
DROP TABLE IF EXISTS `workflow_export_runs`;
CREATE TABLE `workflow_export_runs`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `workflow_run_id` int NOT NULL,
  `status` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `export_format` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `output_file_url` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `error_message` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `started_at` datetime NULL DEFAULT NULL,
  `finished_at` datetime NULL DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `ix_workflow_export_runs_workflow_run_id`(`workflow_run_id` ASC) USING BTREE,
  CONSTRAINT `workflow_export_runs_ibfk_1` FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 5 CHARACTER SET = utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for workflow_runs
-- ----------------------------
DROP TABLE IF EXISTS `workflow_runs`;
CREATE TABLE `workflow_runs`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `owner_user_id` int NOT NULL,
  `overall_status` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  `finished_at` datetime NULL DEFAULT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `ix_workflow_runs_project_id`(`project_id` ASC) USING BTREE,
  INDEX `ix_workflow_runs_owner_user_id`(`owner_user_id` ASC) USING BTREE,
  CONSTRAINT `workflow_runs_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `workflow_runs_ibfk_2` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 5 CHARACTER SET = utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT = Dynamic;

-- ----------------------------
-- Table structure for workflow_step_runs
-- ----------------------------
DROP TABLE IF EXISTS `workflow_step_runs`;
CREATE TABLE `workflow_step_runs`  (
  `id` int NOT NULL AUTO_INCREMENT,
  `workflow_run_id` int NOT NULL,
  `step_key` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `attempt_no` int NOT NULL,
  `input_snapshot` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `output_snapshot` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `error_message` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `started_at` datetime NULL DEFAULT NULL,
  `finished_at` datetime NULL DEFAULT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uq_workflow_step_run_key`(`workflow_run_id` ASC, `step_key` ASC) USING BTREE,
  INDEX `ix_workflow_step_runs_workflow_run_id`(`workflow_run_id` ASC) USING BTREE,
  INDEX `ix_workflow_step_runs_step_key`(`step_key` ASC) USING BTREE,
  CONSTRAINT `workflow_step_runs_ibfk_1` FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE = InnoDB AUTO_INCREMENT = 17 CHARACTER SET = utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT = Dynamic;

SET FOREIGN_KEY_CHECKS = 1;
