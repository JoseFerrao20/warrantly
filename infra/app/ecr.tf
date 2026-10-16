# Registo das imagens Docker da API (o Lambda corre a partir daqui).
resource "aws_ecr_repository" "api" {
  name = "${var.project}-api"
  # Cada imagem é publicada com o SHA do commit e nunca é substituída: o que está no Lambda é
  # sempre o código daquele commit.
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true # procura vulnerabilidades conhecidas em cada imagem
  }
}

# Guarda só as últimas 10 imagens (cada uma ocupa espaço, e o espaço paga-se).
resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Manter as 10 imagens mais recentes"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}
